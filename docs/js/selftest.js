// Debug-only smoke tests, loaded only behind ?debug=1 (see main.js). Uses
// console.assert rather than a test framework, per the project's no-build-
// step constraint. Failures print to the console; nothing is asserted in
// the DOM or blocks app usage.

import { mixtureCdf, sampleMixture, mixtureMedianAnalytic, makeRng, median } from './distributions.js';
import { runSweep } from './sweep.js';
import { loadStatesData } from './data-loader.js';
import { runDynamicIllustrativeDraw, MAX_ITERATIONS } from './dynamic-process.js';
import { runLeaderRuleIllustrativeDraw } from './leader-rule-process.js';

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

// 5. Dynamic abandonment process (dynamic-process.js) checks. A synthetic
// bimodal state so candidates spread across two clusters, giving the
// process something nontrivial to differentiate.
const DYNAMIC_TEST_STATE = { pi: [0.5, 0.5], mu: [-1, 1], sigma: [0.6, 0.6], std: 1.2, mean: 0, median: 0 };

// 5a. M<=k: no (k+1)-th candidate exists, so the process must stop
// immediately at a single trivial, already-converged t=0 snapshot.
function testDynamicTrivialWhenMLteK() {
  const config = { N: 500, M: 5, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'plurality', 5, 0, { lambda: 0.3, eta: 0.03 });
  console.assert(r.steps.length === 1, `[selftest] expected 1 step at M<=k, got ${r.steps.length}`);
  console.assert(r.equilibrium.type === 'trivial', `[selftest] expected trivial equilibrium at M<=k, got ${r.equilibrium.type}`);
  console.log('[selftest] dynamic-process trivial M<=k check done');
}

// 5b. lambda=1, eta=0 should converge fast to a clean, fully-collapsed
// equilibrium (no tolerance means even the top-loser itself isn't safe).
function testDynamicFastConvergenceAtExtremeLambdaEta() {
  const config = { N: 2000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'plurality', 2, 0, { lambda: 1.0, eta: 0.0 });
  console.assert(r.equilibrium.converged, `[selftest] expected convergence at lambda=1,eta=0`);
  console.assert(r.steps.length < 20, `[selftest] expected fast convergence at lambda=1,eta=0, took ${r.steps.length} steps`);
  console.assert(
    r.equilibrium.type === 'duvergerian',
    `[selftest] expected duvergerian equilibrium at lambda=1,eta=0, got ${r.equilibrium.type}`
  );
  console.log('[selftest] dynamic-process fast-convergence check done');
}

// 5c. Large eta with M close to k should sustain more than k+1 candidates
// with meaningful support for longer than eta=0 does (tolerance suppresses
// elimination) -- compare the SAME seed/config at eta=0.1 vs eta=0.
function testDynamicLargeEtaSuppressesElimination() {
  const config = { N: 2000, M: 7, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const rLarge = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 7, 'plurality', 5, 0, { lambda: 0.3, eta: 0.1 });
  const rZero = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 7, 'plurality', 5, 0, { lambda: 0.3, eta: 0.0 });
  console.assert(
    rLarge.equilibrium.nontrivialCount >= rZero.equilibrium.nontrivialCount,
    `[selftest] expected eta=0.1 to retain >= as many viable candidates as eta=0 ` +
      `(got ${rLarge.equilibrium.nontrivialCount} vs ${rZero.equilibrium.nontrivialCount})`
  );
  console.log('[selftest] dynamic-process large-eta-suppresses-elimination check done');
}

// 5d. The Consensus Candidate and candidate positions never change across
// the process -- computed once, identical at every t by construction.
function testDynamicCcAndCandidatesInvariant() {
  const config = { N: 2000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'plurality', 2, 0, { lambda: 0.3, eta: 0.03 });
  const first = r.steps[0];
  const last = r.steps[r.steps.length - 1];
  console.assert(
    first.cc.originalIndex === last.cc.originalIndex,
    `[selftest] expected CC identity to be invariant across t, got ${first.cc.originalIndex} vs ${last.cc.originalIndex}`
  );
  console.assert(first.candidates === last.candidates, `[selftest] expected the same candidates array reference at every t`);
  console.log('[selftest] dynamic-process CC/candidates invariant check done');
}

// 5e. Approval-mean mode should never crash and should never assign a
// candidate zero share while some voter's current choice points at it (a
// voter always approves at least their own current choice).
function testDynamicApprovalOwnChoiceAlwaysApproved() {
  const config = { N: 1000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'approval-mean', 2, 0, { lambda: 0.3, eta: 0.03 });
  for (const step of r.steps) {
    const finalistShares = step.finalists.map((f) => f.tallyValue);
    console.assert(
      finalistShares.every((v) => v > 0),
      `[selftest] expected every finalist to retain positive approval share, got ${finalistShares}`
    );
  }
  console.log('[selftest] dynamic-process approval-mean own-choice check done');
}

// 5f. Raising alpha should only ever slow (never speed up) convergence to a
// duvergerian equilibrium, since (1-vr)^alpha <= (1-vr) for alpha >= 1 and
// vr in [0,1] -- i.e. abandonment can only become less likely per round.
function testDynamicHigherAlphaSlowsConvergence() {
  const config = { N: 2000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const rLow = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'plurality', 2, 0, { lambda: 1.0, eta: 0.0, alpha: 1 });
  const rHigh = runDynamicIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'plurality', 2, 0, { lambda: 1.0, eta: 0.0, alpha: 4 });
  console.assert(
    rHigh.steps.length >= rLow.steps.length,
    `[selftest] expected alpha=4 to converge no faster than alpha=1 ` +
      `(got ${rHigh.steps.length} vs ${rLow.steps.length} steps)`
  );
  console.log('[selftest] dynamic-process higher-alpha-slows-convergence check done');
}

// 6. Multi-winner leader rule (leader-rule-process.js) checks. Same
// synthetic bimodal state as the Duvergerian checks above; rule is always
// 'approval-mean' since the leader rule is approval-only.

// 6a. M<=k: same trivial-case convention as Duvergerian abandonment.
function testLeaderRuleTrivialWhenMLteK() {
  const config = { N: 500, M: 5, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runLeaderRuleIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'approval-mean', 5, 0, { lambda: 0.3 });
  console.assert(r.steps.length === 1, `[selftest] expected 1 step at M<=k, got ${r.steps.length}`);
  console.assert(r.equilibrium.type === 'trivial', `[selftest] expected trivial equilibrium at M<=k, got ${r.equilibrium.type}`);
  console.log('[selftest] leader-rule trivial M<=k check done');
}

// 6b. t=0's ballot is "approve only your favorite" -- trivially a valid
// prefix of the voter's own utility order, so insincereShare must be
// EXACTLY 0 (not just small), per the strict '>' sentinel logic in
// computeInsincereShare.
function testLeaderRuleSincereAtT0() {
  const config = { N: 2000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runLeaderRuleIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'approval-mean', 2, 0, { lambda: 0.3 });
  console.assert(
    r.steps[0].insincereShare === 0,
    `[selftest] expected exactly 0 insincere share at t=0, got ${r.steps[0].insincereShare}`
  );
  console.log('[selftest] leader-rule sincere-at-t0 check done');
}

// 6c. The Consensus Candidate and candidate positions never change across
// the process, same invariant as Duvergerian abandonment.
function testLeaderRuleCcAndCandidatesInvariant() {
  const config = { N: 2000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runLeaderRuleIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'approval-mean', 2, 0, { lambda: 0.3 });
  const first = r.steps[0];
  const last = r.steps[r.steps.length - 1];
  console.assert(
    first.cc.originalIndex === last.cc.originalIndex,
    `[selftest] expected CC identity to be invariant across t, got ${first.cc.originalIndex} vs ${last.cc.originalIndex}`
  );
  console.assert(first.candidates === last.candidates, `[selftest] expected the same candidates array reference at every t`);
  console.log('[selftest] leader-rule CC/candidates invariant check done');
}

// 6d. Basic convergence smoke test: should never throw and should never
// exceed the shared iteration cap.
function testLeaderRuleConvergenceSmoke() {
  const config = { N: 2000, M: 10, delta: 1.0, gamma: 0.0, tau: 0.25 };
  const r = runLeaderRuleIllustrativeDraw(DYNAMIC_TEST_STATE, config, 42, 'approval-mean', 2, 0, { lambda: 0.3 });
  console.assert(
    r.equilibrium.finalT <= MAX_ITERATIONS,
    `[selftest] expected finalT <= MAX_ITERATIONS, got ${r.equilibrium.finalT}`
  );
  console.log('[selftest] leader-rule convergence smoke check done');
}

Promise.all([testMixtureCdf(), testSampleMixtureMoments()])
  .then(() => {
    testSymmetricMedian();
    testVseHundredWhenWinnerEqualsCc();
    testDynamicTrivialWhenMLteK();
    testDynamicFastConvergenceAtExtremeLambdaEta();
    testDynamicLargeEtaSuppressesElimination();
    testDynamicCcAndCandidatesInvariant();
    testDynamicApprovalOwnChoiceAlwaysApproved();
    testDynamicHigherAlphaSlowsConvergence();
    testLeaderRuleTrivialWhenMLteK();
    testLeaderRuleSincereAtT0();
    testLeaderRuleCcAndCandidatesInvariant();
    testLeaderRuleConvergenceSmoke();
    console.log('[selftest] all self-tests completed (see above for any assertion failures)');
  })
  .catch((err) => console.error('[selftest] failed to run', err));
