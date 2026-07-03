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

// ---- Proportional Approval Voting (Thiele's PAV) ---------------------------
//
// Ballots are identical to the mean-threshold approval rule (a voter
// approves every candidate at/above their own mean utility). PAV differs
// only in how ballots become a committee: instead of ranking candidates
// independently and slicing the top k, it scores an entire size-k committee
// by summing, over voters, the harmonic bonus 1 + 1/2 + ... + 1/j (j = how
// many committee members that voter approves), then picks the
// highest-scoring committee. Winning committees for different k need not
// nest, so this is NOT a tallyForRule()+rankCandidates() case -- see
// selectPAVCommittee(), called directly from simulate.js instead.
//
// Exact PAV winner determination is NP-hard in general (brute force is
// O(M choose k)), so we enumerate every committee when that's cheap (the
// paper's default M=10) and fall back to a greedy build + bounded
// local-search swaps -- standard practice for Thiele-rule approximation --
// once the UI's M slider (up to 61) makes exhaustive enumeration too slow.
const PAV_EXACT_COMBO_CAP = 3000;
const PAV_TIE_EPS = 1e-9;

function binomialCoeff(n, r) {
  if (r < 0 || r > n) return 0;
  r = Math.min(r, n - r);
  let result = 1;
  for (let i = 0; i < r; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

// 32-bit population count (SWAR bit-trick).
function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// Per-voter approval set over the M candidates (same threshold as
// approvalTallyMean), packed as a two-word (lo/hi) bitmask so committee
// scoring below can use one AND+popcount per voter instead of looping over
// the committee -- M can be up to 61 (the UI's M slider), more than fits in
// a single 32-bit word. candidate j lives in bit j of `lo` if j<32, else bit
// (j-32) of `hi`.
function computeApprovalMasks(pool, candidates, xMedian, gamma) {
  const M = candidates.length;
  const util = new Float64Array(M);
  const lo = new Int32Array(pool.length);
  const hi = new Int32Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    computeVoterUtilities(pool[i], candidates, xMedian, gamma, util);
    let sum = 0;
    for (let j = 0; j < M; j++) sum += util[j];
    const meanU = sum / M;
    let maskLo = 0,
      maskHi = 0;
    for (let j = 0; j < M; j++) {
      if (util[j] >= meanU) {
        if (j < 32) maskLo |= 1 << j;
        else maskHi |= 1 << (j - 32);
      }
    }
    lo[i] = maskLo;
    hi[i] = maskHi;
  }
  return { lo, hi };
}

function harmonicTable(k) {
  const H = new Float64Array(k + 1);
  for (let j = 1; j <= k; j++) H[j] = H[j - 1] + 1 / j;
  return H;
}

function committeeMask(members) {
  let maskLo = 0,
    maskHi = 0;
  for (let t = 0; t < members.length; t++) {
    const c = members[t];
    if (c < 32) maskLo |= 1 << c;
    else maskHi |= 1 << (c - 32);
  }
  return [maskLo, maskHi];
}

function pavScoreMask(maskLo, maskHi, masks, weights, H) {
  const { lo, hi } = masks;
  let score = 0;
  for (let i = 0; i < lo.length; i++) {
    const cnt = popcount32(lo[i] & maskLo) + popcount32(hi[i] & maskHi);
    if (cnt > 0) score += weights[i] * H[cnt];
  }
  return score;
}

// Advance `combo` (strictly increasing indices into [0, M)) to the next
// combination in lexicographic order; returns false once exhausted.
function nextCombination(combo, M) {
  const k = combo.length;
  let i = k - 1;
  while (i >= 0 && combo[i] === M - k + i) i--;
  if (i < 0) return false;
  combo[i] += 1;
  for (let j = i + 1; j < k; j++) combo[j] = combo[j - 1] + 1;
  return true;
}

// Exhaustive search over every size-k committee. Iterative (not recursive --
// recursion+closures measured ~5x slower for this hot loop), ties broken via
// a random key drawn once per committee from the run's seeded RNG (same
// reproducible-given-seed convention as rankCandidates()).
function pavExact(M, k, masks, weights, rng) {
  const H = harmonicTable(k);
  const combo = new Int32Array(k);
  for (let j = 0; j < k; j++) combo[j] = j;

  let bestScore = -Infinity;
  let bestTieKey = -Infinity;
  let bestCombo = null;

  do {
    const [maskLo, maskHi] = committeeMask(combo);
    const score = pavScoreMask(maskLo, maskHi, masks, weights, H);
    const tieKey = rng.uniform();
    if (score > bestScore + PAV_TIE_EPS) {
      bestScore = score;
      bestTieKey = tieKey;
      bestCombo = combo.slice();
    } else if (Math.abs(score - bestScore) <= PAV_TIE_EPS && tieKey > bestTieKey) {
      bestTieKey = tieKey;
      bestCombo = combo.slice();
    }
  } while (nextCombination(combo, M));

  return bestCombo;
}

// Greedy construction (each of k steps adds the candidate with the largest
// marginal PAV-score gain) followed by a bounded number of local-search
// swap passes (replace a committee member with a non-member whenever it
// strictly improves the score) -- a fast, standard approximation once exact
// enumeration is intractable.
function pavGreedy(M, k, masks, weights, rng) {
  const { lo, hi } = masks;
  const N = lo.length;
  const inCommittee = new Uint8Array(M);
  const committee = [];
  const approvedCount = new Int32Array(N);

  for (let step = 0; step < k; step++) {
    let bestJ = -1;
    let bestGain = -Infinity;
    let bestTieKey = -Infinity;
    for (let j = 0; j < M; j++) {
      if (inCommittee[j]) continue;
      const [bitLo, bitHi] = committeeMask([j]);
      let gain = 0;
      for (let i = 0; i < N; i++) {
        if (lo[i] & bitLo || hi[i] & bitHi) gain += weights[i] / (approvedCount[i] + 1);
      }
      const tieKey = rng.uniform();
      if (gain > bestGain + PAV_TIE_EPS || (Math.abs(gain - bestGain) <= PAV_TIE_EPS && tieKey > bestTieKey)) {
        bestGain = gain;
        bestJ = j;
        bestTieKey = tieKey;
      }
    }
    inCommittee[bestJ] = 1;
    committee.push(bestJ);
    const [bitLo, bitHi] = committeeMask([bestJ]);
    for (let i = 0; i < N; i++) if (lo[i] & bitLo || hi[i] & bitHi) approvedCount[i] += 1;
  }

  const H = harmonicTable(k);
  const MAX_PASSES = 3;
  let improved = true;
  let passes = 0;
  while (improved && passes < MAX_PASSES) {
    improved = false;
    passes += 1;
    for (let a = 0; a < k; a++) {
      const out = committee[a];
      const [baseLo, baseHi] = committeeMask(committee);
      const bestScore0 = pavScoreMask(baseLo, baseHi, masks, weights, H);
      let bestScore = bestScore0;
      let bestJ = -1;
      for (let j = 0; j < M; j++) {
        if (inCommittee[j]) continue;
        committee[a] = j;
        const [ml, mh] = committeeMask(committee);
        const score = pavScoreMask(ml, mh, masks, weights, H);
        if (score > bestScore + PAV_TIE_EPS) {
          bestScore = score;
          bestJ = j;
        }
      }
      if (bestJ !== -1) {
        inCommittee[out] = 0;
        inCommittee[bestJ] = 1;
        committee[a] = bestJ;
        improved = true;
      } else {
        committee[a] = out;
      }
    }
  }
  return committee;
}

// Returns the chosen committee as a plain array of `candidates` indices
// (length k). Callers (simulate.js) turn this into `finalists` entries.
export function selectPAVCommittee(pool, candidates, weights, xMedian, gamma, k, rng) {
  const M = candidates.length;
  const masks = computeApprovalMasks(pool, candidates, xMedian, gamma);
  const nCk = binomialCoeff(M, k);
  return nCk <= PAV_EXACT_COMBO_CAP
    ? Array.from(pavExact(M, k, masks, weights, rng))
    : pavGreedy(M, k, masks, weights, rng);
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
