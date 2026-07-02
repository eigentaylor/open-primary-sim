// Primary-election vote-tallying rules: choose-one plurality and two
// approval variants (mean-utility threshold, fixed-tau threshold).
// Pure functions of (pool, candidates, weights, ..., rng) -- no DOM.

// ---- Utility functions --------------------------------------------------

// Population-level ideological utility (gamma=0), used only for metric 6 (VSE).
export function idealUtility(voterX, candidateY) {
  return -Math.abs(voterX - candidateY);
}

// Primary-stage utility (paper's Eq. 2): blends ideological affinity with
// "electability" (distance of the candidate from the pool median voter).
export function electabilityUtility(voterX, candidateY, xMedian, gamma) {
  return -(1 - gamma) * Math.abs(voterX - candidateY) - gamma * Math.abs(candidateY - xMedian);
}

// Extremist-turnout weight (paper's Eq. 3). delta=1 => uniform weight 1.
export function voterWeight(voterX, maxAbsX, delta) {
  if (maxAbsX === 0) return 1;
  return 1 + (delta - 1) * (Math.abs(voterX) / maxAbsX);
}

// ---- Tally helpers --------------------------------------------------------

function computeVoterUtilities(voterX, candidates, xMedian, gamma, scratch) {
  for (let j = 0; j < candidates.length; j++) {
    scratch[j] = electabilityUtility(voterX, candidates[j], xMedian, gamma);
  }
  return scratch;
}

// Choose-one plurality: each voter's full ballot weight goes to their single
// max-utility candidate. Exact-equality ties broken uniformly at random via
// the run's seeded RNG (never Math.random, never "first index wins").
export function pluralityTally(pool, candidates, weights, xMedian, gamma, rng) {
  const M = candidates.length;
  const tally = new Float64Array(M);
  const util = new Float64Array(M);
  const tiedIdx = new Int32Array(M);

  for (let i = 0; i < pool.length; i++) {
    computeVoterUtilities(pool[i], candidates, xMedian, gamma, util);
    let maxU = -Infinity;
    for (let j = 0; j < M; j++) if (util[j] > maxU) maxU = util[j];
    let nTied = 0;
    for (let j = 0; j < M; j++) if (util[j] === maxU) tiedIdx[nTied++] = j;
    const chosen = nTied === 1 ? tiedIdx[0] : tiedIdx[rng.int(nTied)];
    tally[chosen] += weights[i];
  }
  return tally;
}

// Approval, mean-utility-threshold variant: a voter approves every candidate
// at/above their OWN mean utility across the slate that election (a voter
// with uniform utility across all M candidates approves all of them -- real
// behavior, not a bug). A voter can contribute to multiple candidates'
// totals, unlike plurality -- raw tally magnitudes aren't comparable across
// rules, only relative rank is, which is all top-k selection needs.
export function approvalTallyMean(pool, candidates, weights, xMedian, gamma) {
  const M = candidates.length;
  const tally = new Float64Array(M);
  const util = new Float64Array(M);

  for (let i = 0; i < pool.length; i++) {
    computeVoterUtilities(pool[i], candidates, xMedian, gamma, util);
    let sum = 0;
    for (let j = 0; j < M; j++) sum += util[j];
    const meanU = sum / M;
    for (let j = 0; j < M; j++) {
      if (util[j] >= meanU) tally[j] += weights[i];
    }
  }
  return tally;
}

// Approval, fixed-threshold-tau variant: approve iff utility >= -tau, i.e.
// the voter's effective (electability-blended) "distance" to the candidate
// is within tau.
export function approvalTallyTau(pool, candidates, weights, xMedian, gamma, tau) {
  const M = candidates.length;
  const tally = new Float64Array(M);
  const util = new Float64Array(M);
  const threshold = -tau;

  for (let i = 0; i < pool.length; i++) {
    computeVoterUtilities(pool[i], candidates, xMedian, gamma, util);
    for (let j = 0; j < M; j++) {
      if (util[j] >= threshold) tally[j] += weights[i];
    }
  }
  return tally;
}

export function tallyForRule(rule, pool, candidates, weights, xMedian, gamma, tau, rng) {
  if (rule === 'plurality') return pluralityTally(pool, candidates, weights, xMedian, gamma, rng);
  if (rule === 'approval-mean') return approvalTallyMean(pool, candidates, weights, xMedian, gamma);
  if (rule === 'approval-tau') return approvalTallyTau(pool, candidates, weights, xMedian, gamma, tau);
  throw new Error(`Unknown primary rule: ${rule}`);
}

// Pool-weighted sum of each candidate's electability-blended utility, used
// only as the rankCandidates() tie-break -- a rule-agnostic, gamma-consistent
// secondary signal (voters' own aggregate utility) rather than an arbitrary
// coin flip, for the (common, especially at delta=1 or gamma=1) case where
// two candidates land on the exact same tally.
export function sumUtility(pool, candidates, weights, xMedian, gamma) {
  const M = candidates.length;
  const sums = new Float64Array(M);
  const util = new Float64Array(M);
  for (let i = 0; i < pool.length; i++) {
    computeVoterUtilities(pool[i], candidates, xMedian, gamma, util);
    for (let j = 0; j < M; j++) sums[j] += weights[i] * util[j];
  }
  return sums;
}

// Full M-length ranking (NOT a top-k slice) sorted descending by tally value.
// Ties (common for approval tallies at delta=1, where counts are integers, or
// at gamma=1 where every voter shares the same utility ranking) broken first
// by summed pool utility (still a real signal, not noise), then by a random
// key drawn once per candidate from the seeded RNG for any residual tie, so
// tie order is reproducible-given-seed but not biased toward array order.
// Returns [{candidateX, tallyValue, originalIndex}, ...] length M.
export function rankCandidates(tally, candidates, rng, utilitySum = null) {
  const M = candidates.length;
  const entries = new Array(M);
  for (let j = 0; j < M; j++) {
    entries[j] = {
      candidateX: candidates[j],
      tallyValue: tally[j],
      originalIndex: j,
      utilitySum: utilitySum ? utilitySum[j] : 0,
      tieKey: rng.uniform(),
    };
  }
  entries.sort(
    (a, b) => b.tallyValue - a.tallyValue || b.utilitySum - a.utilitySum || b.tieKey - a.tieKey
  );
  return entries;
}
