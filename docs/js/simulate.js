// Single-iteration simulation: voter pool setup (once per run), one
// primary+general-election iteration, and per-iteration metric computation.
// Pure functions of (stateParams, config, rng) -- no aggregation here;
// that's sweep.js's job (see the VSE sums-then-divide-once requirement).

import { sampleMixture, median, mixtureCdf } from './distributions.js';
import {
  voterWeight,
  tallyForRule,
  rankCandidates,
  sumUtility,
  idealUtility,
  approvalTallyMean,
  selectPAVCommittee,
} from './primary-rules.js';

// ---- Run-level setup (once per state selection; shared across all
// {rule,k} configs in a sweep -- see plan Sec "Decisions resolved") --------

export function setupRun(stateParams, config, rng) {
  const pool = sampleMixture(config.N, stateParams, rng);
  const xMedianPool = median(pool);

  let maxAbsX = 0;
  for (let i = 0; i < pool.length; i++) {
    const a = Math.abs(pool[i]);
    if (a > maxAbsX) maxAbsX = a;
  }

  // delta is fixed for the whole run/sweep, so voter weights are constant
  // across every iteration and every {rule,k} config -- compute once.
  const weights = new Float64Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    weights[i] = voterWeight(pool[i], maxAbsX, config.delta);
  }

  return { pool, xMedianPool, maxAbsX, weights, stateParams, config };
}

// ---- Tie-break helper: argmin over a list with a random tie-break --------

function argminIndex(values, rng) {
  let minV = Infinity;
  for (let i = 0; i < values.length; i++) if (values[i] < minV) minV = values[i];
  let nTied = 0;
  const tied = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] === minV) {
      tied.push(i);
      nTied++;
    }
  }
  return nTied === 1 ? tied[0] : tied[rng.int(nTied)];
}

function meanUtilityOverPool(pool, candidateX) {
  let sum = 0;
  for (let i = 0; i < pool.length; i++) sum += idealUtility(pool[i], candidateX);
  return sum / pool.length;
}

// Head-to-head tally between two finalists: each voter's ballot goes to
// whichever is ideologically nearer. Exact ties (a voter equidistant from
// both) are rare with continuous positions but not impossible on a finite
// pool, and are split via the run's seeded RNG (never Math.random), same
// tie-break convention as every other tally in this file/primary-rules.js.
function pairwiseTally(pool, xa, xb, weights, rng) {
  let aVotes = 0,
    bVotes = 0;
  for (let i = 0; i < pool.length; i++) {
    const da = Math.abs(pool[i] - xa);
    const db = Math.abs(pool[i] - xb);
    if (da < db) aVotes += weights[i];
    else if (db < da) bVotes += weights[i];
    else if (rng.uniform() < 0.5) aVotes += weights[i];
    else bVotes += weights[i];
  }
  return [aVotes, bVotes];
}

// ---- One iteration: stage 2 (candidate draw) -> stage 3 (primary) ->
// stage 4 (deterministic median-closest winner among finalists) ------------

// Stage 2: M candidates drawn uniformly, without replacement, from the pool.
// Extracted so the dynamic-abandonment process (dynamic-process.js) can draw
// the identical candidate slate a static illustrative draw would for the
// same seed/drawIndex/rule/k -- must be this rng stream's first consumption
// in both callers, so the two paths stay byte-identical up to this point.
export function drawCandidates(pool, M, rng) {
  const candIdx = rng.choiceIndicesWithoutReplacement(pool.length, M);
  const candidates = new Float64Array(M);
  for (let j = 0; j < M; j++) candidates[j] = pool[candIdx[j]];
  return candidates;
}

// Full-detail version of one iteration: returns candidates/ranking/finalists/
// winner/cc as well as the metrics, so the illustrative single-draw chart can
// plot the actual candidate placements (runIteration() below only needs the
// metrics and is what the sweep's hot loop calls).
export function runIterationDetailed(ctx, rule, k, rng) {
  const { pool, xMedianPool, weights, stateParams, config } = ctx;
  const M = config.M;

  const candidates = drawCandidates(pool, M, rng);

  // Stage 3: primary tally/committee selection (dispatches by rule).
  const utilitySum = sumUtility(pool, candidates, weights, xMedianPool, config.gamma);
  let ranking, finalists;
  if (rule === 'pav') {
    // PAV picks the whole size-k committee at once -- it isn't a per-
    // candidate tally sliced to top-k (see selectPAVCommittee's comment),
    // so `ranking` here is only the individual-approval-tally ordering used
    // for display/ccRank purposes; `finalists` come from the actual PAV
    // committee, which need not be that ranking's top k.
    const approvalTally = approvalTallyMean(pool, candidates, weights, xMedianPool, config.gamma);
    ranking = rankCandidates(approvalTally, candidates, rng, utilitySum);
    const committeeIdx = new Set(selectPAVCommittee(pool, candidates, weights, xMedianPool, config.gamma, k, rng));
    finalists = ranking.filter((entry) => committeeIdx.has(entry.originalIndex));
  } else {
    const tally = tallyForRule(rule, pool, candidates, weights, xMedianPool, config.gamma, config.tau, rng);
    ranking = rankCandidates(tally, candidates, rng, utilitySum);
    finalists = ranking.slice(0, k);
  }

  // Stage 4: winner = finalist closest to the pool median, plus every
  // pairwise general-election matchup among the finalists.
  const { winner, generalMatchups } = computeGeneralResult(pool, finalists, weights, xMedianPool, rng);

  // Consensus Candidate (CC): closest-to-median among the FULL M-candidate
  // slate, independent of whether they survive the primary.
  const cc = computeConsensusCandidate(candidates, xMedianPool, rng);

  // ccRank: 1-based position of the CC within the full ranking.
  const ccRank = findCandidateRank(ranking, cc.originalIndex);

  const metrics = computeIterationMetrics({ pool, stateParams }, finalists, winner, cc, ccRank, candidates, rng);
  return { candidates, ranking, finalists, winner, cc, ccRank, generalMatchups, metrics };
}

// Stage 4a: winner = finalist closest to the pool median (paper's
// condorcet.general, reused for all k -- deterministic given finalists).
// General election runs under the Condorcet rule (paper's assumption --
// `winner` is exactly the Condorcet winner among the finalists, since
// single-peaked 1D preferences guarantee the median-closest candidate beats
// every other finalist head-to-head). For display we compute every pairwise
// matchup (k choose 2 of them), not just a single aggregate tally -- a
// plurality-style single tally across 3+ finalists would be vulnerable to
// vote-splitting/spoiler effects that a genuine Condorcet count isn't. Each
// matchup is a head-to-head: every voter's ballot goes to whichever of the
// two finalists is ideologically nearer (gamma=0 -- no primary
// "electability" blending once we're down to the general slate), weighted
// by the same turnout weights as the primary.
// Extracted so the dynamic-abandonment process can recompute a fresh
// winner/matchups at every polling round from that round's finalists,
// reusing exactly the static single-draw logic.
export function computeGeneralResult(pool, finalists, weights, xMedianPool, rng) {
  const finalistDists = finalists.map((f) => Math.abs(f.candidateX - xMedianPool));
  const winner = finalists[argminIndex(finalistDists, rng)];

  const k2 = finalists.length;
  const generalMatchups = [];
  for (let a = 0; a < k2; a++) {
    for (let b = a + 1; b < k2; b++) {
      const [aVotes, bVotes] = pairwiseTally(pool, finalists[a].candidateX, finalists[b].candidateX, weights, rng);
      generalMatchups.push({
        aIndex: a,
        bIndex: b,
        aOriginalIndex: finalists[a].originalIndex,
        bOriginalIndex: finalists[b].originalIndex,
        aVotes,
        bVotes,
      });
    }
  }
  return { winner, generalMatchups };
}

// Consensus Candidate (CC): closest-to-median among the FULL M-candidate
// slate, independent of whether they survive the primary. Extracted so the
// dynamic-abandonment process can compute this ONCE per run (candidate
// positions never change across polling rounds, so the CC is identical at
// every t) instead of once per round.
export function computeConsensusCandidate(candidates, xMedianPool, rng) {
  const M = candidates.length;
  const allDists = new Array(M);
  for (let j = 0; j < M; j++) allDists[j] = Math.abs(candidates[j] - xMedianPool);
  const ccOriginalIndex = argminIndex(allDists, rng);
  return { candidateX: candidates[ccOriginalIndex], originalIndex: ccOriginalIndex };
}

// 1-based position of a candidate (by originalIndex) within a `ranking`
// array (as returned by rankCandidates()). A plain linear search -- fine for
// once-per-iteration/once-per-round use (ccRank), but NOT suited to a
// per-voter hot loop (the dynamic process builds its own O(1) rank lookup
// array for that instead).
export function findCandidateRank(ranking, originalIndex) {
  for (let i = 0; i < ranking.length; i++) {
    if (ranking[i].originalIndex === originalIndex) return i + 1;
  }
  return 1;
}

// Sum of turnout weights across the pool -- shared by chart modules
// (election-results.js, vote-share-histogram.js) that need to convert raw
// tally values into a percentage of voters, and by the dynamic process for
// its share-of-total-weight convergence check.
export function totalWeight(ctx) {
  let sum = 0;
  for (let i = 0; i < ctx.weights.length; i++) sum += ctx.weights[i];
  return sum;
}

// Sweep's hot-loop entry point: same as runIterationDetailed() but returns
// only the metrics object (the sweep aggregates metrics only; it never
// inspects individual candidate/ranking detail).
export function runIteration(ctx, rule, k, rng) {
  return runIterationDetailed(ctx, rule, k, rng).metrics;
}

// ---- Per-iteration metrics (raw values; sweep.js aggregates expectations) ---

export function computeIterationMetrics(ctx, finalists, winner, cc, ccRank, candidates, rng) {
  const { pool, stateParams } = ctx;
  const k = finalists.length;

  // Metric 1: runoff competitiveness -- max C_ij over all finalist pairs,
  // using the ANALYTIC population CDF (not the finite pool).
  let maxC = 0;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const m = (finalists[i].candidateX + finalists[j].candidateX) / 2;
      const Fm = mixtureCdf(m, stateParams);
      const Cij = 2 * Math.min(Fm, 1 - Fm);
      if (Cij > maxC) maxC = Cij;
    }
  }

  // Metric 2: party diversity (binary).
  let hasLeft = false,
    hasRight = false;
  for (let i = 0; i < k; i++) {
    if (finalists[i].candidateX < 0) hasLeft = true;
    if (finalists[i].candidateX > 0) hasRight = true;
  }
  const partyDiversity = hasLeft && hasRight ? 1 : 0;

  // Metric 3: candidate diversity, normalized by the state's population std.
  let fMin = Infinity,
    fMax = -Infinity;
  for (let i = 0; i < k; i++) {
    if (finalists[i].candidateX < fMin) fMin = finalists[i].candidateX;
    if (finalists[i].candidateX > fMax) fMax = finalists[i].candidateX;
  }
  const candidateDiversity = (fMax - fMin) / stateParams.std;

  // Metric 4: consensus capture -- CC present among finalists, by ORIGINAL
  // INDEX membership (not float value equality; defensive against any
  // future refactor that copies/rounds candidate values).
  let consensusCapture = 0;
  for (let i = 0; i < k; i++) {
    if (finalists[i].originalIndex === cc.originalIndex) {
      consensusCapture = 1;
      break;
    }
  }

  // Metric 6 raw inputs (population-level, gamma=0 utility over the fixed pool).
  // sweep.js accumulates these across n.sim iterations and divides once.
  const winnerUtility = meanUtilityOverPool(pool, winner.candidateX);
  const randomIdx = rng.int(candidates.length);
  const randomCandUtility = meanUtilityOverPool(pool, candidates[randomIdx]);
  const ccUtility = meanUtilityOverPool(pool, cc.candidateX);

  return {
    maxC,
    partyDiversity,
    candidateDiversity,
    consensusCapture,
    ccRank,
    winnerUtility,
    randomCandUtility,
    ccUtility,
  };
}
