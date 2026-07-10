// Multi-winner "generalized leader rule" dynamic polling process (Laslier &
// van der Straeten, 2016, "Strategic Voting in Multi-Winner Elections with
// Approval Balloting"): an approval-only, illustrative-draw-only sibling of
// dynamic-process.js's Duvergerian abandonment. Instead of a single "current
// choice" per voter, every voter maintains a FULL approval ballot that gets
// entirely redefined when they reconsider:
//   - for a current winner x_j (rank <= k): approve iff u(x_j) > u(x_(k+1))
//     (prefer this winner to the first loser/pivot)
//   - for a current loser x_j (rank > k): approve iff u(x_j) > u(x_k)
//     (prefer this loser to the last winner)
// This can produce "insincere" (gappy) ballots -- e.g. approving your 1st
// and 3rd favorite but not your 2nd -- which is the whole point of tracking
// this rule; see computeInsincereShare below.
//
// The approve/disapprove decision is a deterministic strict inequality, so
// (unlike Duvergerian abandonment's argmaxAmongMask) reconsideration never
// consumes rng: there's no argmax/tie to break here. A voter whose own
// utility for the last winner exactly equals their utility for the pivot
// deterministically disapproves BOTH -- a faithful reading of the rule's
// strict inequalities, not a bug.

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
import { sumUtility } from './primary-rules.js';
import {
  buildUtilityMatrix,
  computeInitialChoice,
  buildRanking,
  FINALIST_LETTERS,
  CONVERGENCE_EPS,
  MAX_ITERATIONS,
} from './dynamic-process.js';

// Approval tally from a maintained per-voter ballot matrix (Uint8Array,
// row-major ballot[i*M+j]) -- the leader-rule analog of dynamic-process.js's
// computeShare, but reading a maintained ballot instead of deriving one from
// a single "current choice" each round.
function computeShareFromBallot(ballot, weights, N, M) {
  const share = new Float64Array(M);
  for (let i = 0; i < N; i++) {
    const base = i * M;
    const w = weights[i];
    for (let j = 0; j < M; j++) {
      if (ballot[base + j]) share[j] += w;
    }
  }
  return share;
}

// t=0 sincere ballot: approve only the voter's own favorite (same "sincere"
// baseline computeInitialChoice already defines for Duvergerian abandonment)
// -- trivially a valid prefix of the voter's own utility order, so t=0's
// insincereShare is guaranteed exactly 0 (see testLeaderRuleSincereAtT0).
function initBallotFromChoice(choice, N, M) {
  const ballot = new Uint8Array(N * M);
  for (let i = 0; i < N; i++) ballot[i * M + choice[i]] = 1;
  return ballot;
}

// Weighted proportion of voters whose ballot is NOT a "prefix" of their own
// utility ordering (i.e. some unapproved candidate is strictly preferred to
// some approved one). O(M) per voter, no sort needed: a ballot is sincere
// iff every approved candidate's utility >= every unapproved candidate's
// utility, i.e. iff maxUtilUnapproved <= minUtilApproved. The -Infinity/
// +Infinity sentinels correctly read an all-approved or all-disapproved
// ballot as sincere (a trivial/empty prefix). Strict '>' (not '>=') is
// required so an exact utility tie straddling the approve/disapprove
// boundary doesn't falsely register as insincere -- this is what keeps t=0
// exactly 0 despite computeInitialChoice's tie-break leaving a
// tied-at-max-utility companion candidate unapproved.
function computeInsincereShare(ballot, utilMatrix, weights, N, M, tw) {
  let insincereWeight = 0;
  for (let i = 0; i < N; i++) {
    const base = i * M;
    let maxUnapproved = -Infinity;
    let minApproved = Infinity;
    for (let j = 0; j < M; j++) {
      const u = utilMatrix[base + j];
      if (ballot[base + j]) {
        if (u < minApproved) minApproved = u;
      } else if (u > maxUnapproved) {
        maxUnapproved = u;
      }
    }
    if (maxUnapproved > minApproved) insincereWeight += weights[i];
  }
  return insincereWeight / tw;
}

// Full ballot replacement for one reconsidering voter, from this round's
// rank-of-candidate array and the two pivot candidates' original indices
// (xkIdx = last winner, xk1Idx = first loser/pivot). Deterministic -- see
// this module's header comment on why no rng is consumed here.
function recomputeBallotRow(ballot, utilMatrix, i, M, rankOf, k, xkIdx, xk1Idx) {
  const base = i * M;
  const uXk = utilMatrix[base + xkIdx];
  const uXk1 = utilMatrix[base + xk1Idx];
  for (let j = 0; j < M; j++) {
    ballot[base + j] = rankOf[j] <= k ? (utilMatrix[base + j] > uXk1 ? 1 : 0) : (utilMatrix[base + j] > uXk ? 1 : 0);
  }
}

// Round-mechanics core, illustrative-draw-only (so unlike dynamic-process.js's
// runRounds, there's no full/non-full branching -- every round builds a
// complete detail snapshot via the caller-supplied buildDetail).
function runLeaderRuleRounds({ weights, utilMatrix, N, M, candidates, k, rng, lambda, tw, utilitySum, buildDetail }) {
  // Trivial case: no (k+1)-th candidate exists, so there's no pivot and no
  // reconsideration step can run -- report a single t=0 snapshot as converged.
  if (M <= k) {
    const choice0 = computeInitialChoice(utilMatrix, N, M, rng);
    const ballot = initBallotFromChoice(choice0, N, M);
    const shareArr = computeShareFromBallot(ballot, weights, N, M);
    const { ranking, finalists } = buildRanking(shareArr, candidates, k, rng, utilitySum);
    const insincereShare = computeInsincereShare(ballot, utilMatrix, weights, N, M, tw);
    const round = buildDetail(shareArr, ranking, finalists, insincereShare);
    return { steps: [round], converged: true, finalT: 0, trivial: true };
  }

  const choice0 = computeInitialChoice(utilMatrix, N, M, rng);
  const ballot = initBallotFromChoice(choice0, N, M);
  const rankOf = new Int32Array(M);

  const steps = [];
  let prevShareArr = null;
  let converged = false;
  let t = 0;

  for (;;) {
    const shareArr = computeShareFromBallot(ballot, weights, N, M);
    const { ranking, finalists } = buildRanking(shareArr, candidates, k, rng, utilitySum);
    const insincereShare = computeInsincereShare(ballot, utilMatrix, weights, N, M, tw);
    steps.push(buildDetail(shareArr, ranking, finalists, insincereShare));

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

    for (let idx = 0; idx < ranking.length; idx++) rankOf[ranking[idx].originalIndex] = idx + 1;
    const xkIdx = ranking[k - 1].originalIndex;
    const xk1Idx = ranking[k].originalIndex;

    const reconsiderCount = Math.round(lambda * N);
    const reconsiderIdx = rng.choiceIndicesWithoutReplacement(N, reconsiderCount);
    for (let idx = 0; idx < reconsiderIdx.length; idx++) {
      recomputeBallotRow(ballot, utilMatrix, reconsiderIdx[idx], M, rankOf, k, xkIdx, xk1Idx);
    }

    prevShareArr = shareArr;
    t += 1;
  }

  return { steps, converged, finalT: t, trivial: false };
}

// Entry point, mirroring dynamic-process.js's runDynamicIllustrativeDraw
// seeding scheme exactly so the same seed/drawIndex/k draws the byte-
// identical candidate slate as the static and Duvergerian paths. `rule` is
// always 'approval-mean' here -- it's kept as a param purely so this label
// formula (and hence slate reproducibility) matches the other two paths; it
// is NOT used to pick a tally algorithm -- the leader-rule tally is always
// the ballot-based approval sum above.
export function runLeaderRuleIllustrativeDraw(stateParams, config, seed, rule, k, drawIndex, { lambda }) {
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

  function buildDetail(shareArr, ranking, finalists, insincereShare) {
    const { winner, generalMatchups } = computeGeneralResult(pool, finalists, weights, xMedianPool, processRng);
    const ccRank = findCandidateRank(ranking, cc.originalIndex);
    const metrics = computeIterationMetrics({ pool, stateParams }, finalists, winner, cc, ccRank, candidates, processRng);
    return { candidates, ranking, finalists, winner, cc, ccRank, generalMatchups, metrics, insincereShare };
  }

  const { steps, converged, finalT, trivial } = runLeaderRuleRounds({
    weights,
    utilMatrix,
    N,
    M,
    candidates,
    k,
    rng: processRng,
    lambda,
    tw,
    utilitySum,
    buildDetail,
  });

  const lastStep = steps[steps.length - 1];
  const equilibrium = trivial
    ? { type: 'trivial', converged: true, finalT: 0, nontrivialCount: null }
    : { type: 'leader-rule', converged, finalT, nontrivialCount: null };
  const letterMap = new Map(lastStep.finalists.map((f, i) => [f.originalIndex, FINALIST_LETTERS[i]]));

  return { ctx, steps, equilibrium, letterMap };
}
