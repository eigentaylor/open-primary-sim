// Duvergerian-abandonment dynamic polling process: an optional, single-draw
// alternative to the one-shot primary tally in simulate.js. Instead of
// computing a static tally once, voters start with their sincere favorite
// and, poll after poll, a damped fraction reconsider whether to abandon
// their current choice for a more "viable" one -- an implementation of
// Cox's SNTV/plurality-jungle result that an M-seat office sustains M+1
// viable candidates (M there = this app's `k`: the number of finalists
// advancing to the general).
//
// Candidate positions never change during the process -- only each voter's
// CURRENT CHOICE evolves. Every per-round "held election" snapshot is built
// from the exact same helpers the static single-shot path
// (simulate.js's runIterationDetailed) uses, so every existing renderer
// (density chart, draw-metrics, election-results, the new histogram) works
// unchanged fed any one snapshot from `steps`.

import { makeRng, hashSeed } from './distributions.js';
import {
  setupRun,
  drawCandidates,
  computeGeneralResult,
  computeConsensusCandidate,
  findCandidateRank,
  computeIterationMetrics,
  totalWeight,
} from './simulate.js';
import { rankCandidates, sumUtility, electabilityUtility } from './primary-rules.js';

// Fixed internal constants (not user-facing -- see the plan's "locked
// decisions"). CONVERGENCE_EPS is in units of share-of-total-weight, so it's
// scale-free regardless of pool size N. NONTRIVIAL_SHARE_FRAC is the
// classification threshold for "still holds meaningful support" when
// distinguishing a Duvergerian (exactly k+1 nontrivial candidates)
// equilibrium from a non-Duvergerian one (a plateau of more than k+1).
export const CONVERGENCE_EPS = 1e-4;
export const MAX_ITERATIONS = 250;
const NONTRIVIAL_SHARE_FRAC = 0.02;

const FINALIST_LETTERS = 'ABCDE';

// Full N*M utility matrix (row-major: utilMatrix[i*M+j] = voter i's utility
// for candidate j), built once since positions are fixed for the whole
// process -- every round's "most preferred within a filtered subset" lookup
// reads from this instead of recomputing electabilityUtility() every time.
function buildUtilityMatrix(pool, candidates, xMedianPool, gamma) {
  const N = pool.length;
  const M = candidates.length;
  const util = new Float64Array(N * M);
  for (let i = 0; i < N; i++) {
    const base = i * M;
    for (let j = 0; j < M; j++) {
      util[base + j] = electabilityUtility(pool[i], candidates[j], xMedianPool, gamma);
    }
  }
  return util;
}

// t=0: every voter's current choice is their own highest-utility candidate
// (ties broken via the run's seeded rng, same convention as pluralityTally).
function computeInitialChoice(utilMatrix, N, M, rng) {
  const choice = new Int32Array(N);
  const tied = new Int32Array(M);
  for (let i = 0; i < N; i++) {
    const base = i * M;
    let maxU = -Infinity;
    for (let j = 0; j < M; j++) if (utilMatrix[base + j] > maxU) maxU = utilMatrix[base + j];
    let nTied = 0;
    for (let j = 0; j < M; j++) if (utilMatrix[base + j] === maxU) tied[nTied++] = j;
    choice[i] = nTied === 1 ? tied[0] : tied[rng.int(nTied)];
  }
  return choice;
}

// Vote share s(j) for every candidate from the current per-voter choices.
//   - plurality: each voter's full weight goes to their current choice.
//   - approval-mean: each voter approves their current choice AND every
//     candidate they sincerely like at least as much (utility >= their own
//     current choice's utility). A voter's own current choice always
//     satisfies this trivially (u >= u), so s(currentChoice[i]) > 0 always
//     holds for both rules -- this is what makes the viability-ratio
//     division below always safe wherever it's actually evaluated.
function computeShare(rule, currentChoice, weights, utilMatrix, N, M) {
  const share = new Float64Array(M);
  if (rule === 'plurality') {
    for (let i = 0; i < N; i++) share[currentChoice[i]] += weights[i];
  } else {
    for (let i = 0; i < N; i++) {
      const base = i * M;
      const uOwn = utilMatrix[base + currentChoice[i]];
      for (let j = 0; j < M; j++) {
        if (utilMatrix[base + j] >= uOwn) share[j] += weights[i];
      }
    }
  }
  return share;
}

// Highest-utility candidate for voter i among the candidates flagged in
// `mask` (a Uint8Array(M)). Falls back to `fallbackIdx` (the voter's current
// choice) if no candidate satisfies the mask -- a defensive guard for the
// boundary case where an exact tie at eta=0 excludes every candidate from
// a filtered set; the voter simply doesn't move that round.
function argmaxAmongMask(utilMatrix, i, M, mask, rng, tiedScratch, fallbackIdx) {
  const base = i * M;
  let maxU = -Infinity;
  for (let j = 0; j < M; j++) {
    if (mask[j] && utilMatrix[base + j] > maxU) maxU = utilMatrix[base + j];
  }
  if (maxU === -Infinity) return fallbackIdx;
  let nTied = 0;
  for (let j = 0; j < M; j++) {
    if (mask[j] && utilMatrix[base + j] === maxU) tiedScratch[nTied++] = j;
  }
  return nTied === 1 ? tiedScratch[0] : tiedScratch[rng.int(nTied)];
}

// Builds one "held election" snapshot from a round's vote shares, shaped
// exactly like simulate.js's runIterationDetailed() return value (minus the
// `metrics`/`ccRank` fields it doesn't yet have -- filled in by the caller).
function buildRanking(shareArr, candidates, k, rng, utilitySum) {
  const ranking = rankCandidates(shareArr, candidates, rng, utilitySum);
  const finalists = ranking.slice(0, k);
  return { ranking, finalists };
}

function classifyEquilibrium(finalRanking, k, tw, converged, finalT) {
  const nontrivialCount = finalRanking.filter((e) => e.tallyValue / tw > NONTRIVIAL_SHARE_FRAC).length;
  const type = nontrivialCount <= k + 1 ? 'duvergerian' : 'non-duvergerian';
  return { type, converged, finalT, nontrivialCount };
}

// Entry point, mirroring sweep.js's runIllustrativeDraw() shape/seeding so a
// dynamic-mode run with the same seed/drawIndex/rule/k draws the IDENTICAL
// candidate slate a static illustrative draw would (drawCandidates() is
// this rng stream's first consumption in both paths).
export function runDynamicIllustrativeDraw(stateParams, config, seed, rule, k, drawIndex, { lambda, eta }) {
  const label = `illustrative_${drawIndex}`;
  const poolRng = makeRng(hashSeed(seed, `${label}_pool`));
  const ctx = setupRun(stateParams, config, poolRng);
  const { pool, xMedianPool, weights } = ctx;
  const N = pool.length;

  const processRng = makeRng(hashSeed(seed, `${label}_${rule}_k${k}`));
  const candidates = drawCandidates(pool, config.M, processRng);
  const M = candidates.length;

  const cc = computeConsensusCandidate(candidates, xMedianPool, processRng);
  const utilitySum = sumUtility(pool, candidates, weights, xMedianPool, config.gamma);
  const utilMatrix = buildUtilityMatrix(pool, candidates, xMedianPool, config.gamma);
  const tw = totalWeight(ctx);

  function buildStep(shareArr) {
    const { ranking, finalists } = buildRanking(shareArr, candidates, k, processRng, utilitySum);
    const { winner, generalMatchups } = computeGeneralResult(pool, finalists, weights, xMedianPool, processRng);
    const ccRank = findCandidateRank(ranking, cc.originalIndex);
    const metrics = computeIterationMetrics({ pool, stateParams }, finalists, winner, cc, ccRank, candidates, processRng);
    return { candidates, ranking, finalists, winner, cc, ccRank, generalMatchups, metrics };
  }

  // Trivial case: no (k+1)-th candidate exists, so there's no pivot and no
  // abandonment step can run -- report a single t=0 snapshot as converged.
  if (M <= k) {
    const shareArr = computeShare(rule, computeInitialChoice(utilMatrix, N, M, processRng), weights, utilMatrix, N, M);
    const step0 = buildStep(shareArr);
    const letterMap = new Map(step0.finalists.map((f, i) => [f.originalIndex, FINALIST_LETTERS[i]]));
    return {
      ctx,
      steps: [step0],
      equilibrium: { type: 'trivial', converged: true, finalT: 0, nontrivialCount: null },
      letterMap,
    };
  }

  const currentChoice = computeInitialChoice(utilMatrix, N, M, processRng);
  const tiedScratch = new Int32Array(M);
  const rankOf = new Int32Array(M);
  const viableMask = new Uint8Array(M);

  const steps = [];
  let prevShareArr = null;
  let converged = false;
  let t = 0;

  for (;;) {
    const shareArr = computeShare(rule, currentChoice, weights, utilMatrix, N, M);
    const step = buildStep(shareArr);
    steps.push(step);

    if (prevShareArr) {
      let maxDiff = 0;
      for (let j = 0; j < M; j++) {
        const d = Math.abs(shareArr[j] - prevShareArr[j]) / tw;
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff < CONVERGENCE_EPS) {
        converged = true;
        break;
      }
    }
    if (t >= MAX_ITERATIONS) {
      converged = false;
      break;
    }

    // Round update t -> t+1, reading only from this round's own snapshot
    // (`step.ranking`/`shareArr`) -- a synchronous update, applied together.
    for (let idx = 0; idx < step.ranking.length; idx++) rankOf[step.ranking[idx].originalIndex] = idx + 1;
    const pivotShare = step.ranking[k].tallyValue;
    for (let j = 0; j < M; j++) viableMask[j] = shareArr[j] > pivotShare - eta ? 1 : 0;

    const reconsiderCount = Math.round(lambda * N);
    const reconsiderIdx = processRng.choiceIndicesWithoutReplacement(N, reconsiderCount);
    const towardMaskCache = new Map();

    for (let idx = 0; idx < reconsiderIdx.length; idx++) {
      const i = reconsiderIdx[idx];
      const j = currentChoice[i];
      const rank = rankOf[j];
      if (rank <= k + 1) {
        currentChoice[i] = argmaxAmongMask(utilMatrix, i, M, viableMask, processRng, tiedScratch, j);
      } else {
        // s(j) > 0 always (see computeShare's header comment), and since
        // shares are sorted descending and j's rank is > k+1, pivotShare
        // (rank k+1's share) >= s(j) > 0 -- so this division is always safe.
        const vr = shareArr[j] / pivotShare;
        if (processRng.uniform() < 1 - vr) {
          let mask = towardMaskCache.get(j);
          if (!mask) {
            mask = new Uint8Array(M);
            const threshold = shareArr[j] - eta;
            for (let jj = 0; jj < M; jj++) mask[jj] = shareArr[jj] > threshold ? 1 : 0;
            // Abandoning current choice j means picking the most preferred
            // ALTERNATIVE -- j must be excluded from its own target set, or
            // a voter whose current choice is still their sincere favorite
            // (true at t=0, and thereafter for anyone who has never yet
            // moved) would trivially "abandon" right back to itself, since
            // nothing can out-rank a voter's own sincere-utility-maximizing
            // pick within any set that still contains it. Without this
            // exclusion the whole process is a permanent no-op.
            mask[j] = 0;
            towardMaskCache.set(j, mask);
          }
          currentChoice[i] = argmaxAmongMask(utilMatrix, i, M, mask, processRng, tiedScratch, j);
        }
      }
    }

    prevShareArr = shareArr;
    t += 1;
  }

  const finalStep = steps[steps.length - 1];
  const equilibrium = classifyEquilibrium(finalStep.ranking, k, tw, converged, steps.length - 1);
  const letterMap = new Map(finalStep.finalists.map((f, i) => [f.originalIndex, FINALIST_LETTERS[i]]));

  return { ctx, steps, equilibrium, letterMap };
}
