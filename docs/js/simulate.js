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

// ---- One iteration: stage 2 (candidate draw) -> stage 3 (primary) ->
// stage 4 (deterministic median-closest winner among finalists) ------------

// Full-detail version of one iteration: returns candidates/ranking/finalists/
// winner/cc as well as the metrics, so the illustrative single-draw chart can
// plot the actual candidate placements (runIteration() below only needs the
// metrics and is what the sweep's hot loop calls).
export function runIterationDetailed(ctx, rule, k, rng) {
  const { pool, xMedianPool, weights, stateParams, config } = ctx;
  const M = config.M;

  // Stage 2: M candidates drawn uniformly, without replacement, from the pool.
  const candIdx = rng.choiceIndicesWithoutReplacement(pool.length, M);
  const candidates = new Float64Array(M);
  for (let j = 0; j < M; j++) candidates[j] = pool[candIdx[j]];

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

  // Stage 4: winner = finalist closest to the pool median (paper's
  // condorcet.general, reused for all k -- deterministic given finalists).
  const finalistDists = finalists.map((f) => Math.abs(f.candidateX - xMedianPool));
  const winner = finalists[argminIndex(finalistDists, rng)];

  // Consensus Candidate (CC): closest-to-median among the FULL M-candidate
  // slate, independent of whether they survive the primary.
  const allDists = new Array(M);
  for (let j = 0; j < M; j++) allDists[j] = Math.abs(candidates[j] - xMedianPool);
  const ccOriginalIndex = argminIndex(allDists, rng);
  const cc = { candidateX: candidates[ccOriginalIndex], originalIndex: ccOriginalIndex };

  // ccRank: 1-based position of the CC within the full ranking.
  let ccRank = 1;
  for (let i = 0; i < ranking.length; i++) {
    if (ranking[i].originalIndex === ccOriginalIndex) {
      ccRank = i + 1;
      break;
    }
  }

  const metrics = computeIterationMetrics({ pool, stateParams }, finalists, winner, cc, ccRank, candidates, rng);
  return { candidates, ranking, finalists, winner, cc, ccRank, metrics };
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
