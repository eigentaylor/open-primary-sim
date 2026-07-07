// Batch runner: for a given state, draws ONE shared voter pool and then
// runs n.sim Monte Carlo iterations for each {rule,k} config, accumulating
// metric sums and dividing once at the end (this is what makes VSE a ratio
// of simulation-level expectations, not an average of per-iteration ratios).

import { makeRng, hashSeed } from './distributions.js';
import { setupRun, runIteration, runIterationDetailed } from './simulate.js';
import { runDynamicIteration } from './dynamic-process.js';

export const RULES = ['plurality', 'approval-mean', 'approval-tau'];
// PAV is opt-in (see the UI's "Use PAV" toggle, default off): exact PAV
// committee selection is combinatorially expensive (brute-force over every
// size-k committee, see selectPAVCommittee), so it isn't included in every
// sweep by default the way the other rules are.
export const OPTIONAL_RULES = ['pav'];
// Dynamic-abandonment-process variants of plurality/approval-mean (see
// dynamic-process.js) -- also opt-in (see the UI's "Include dynamic-process
// variants" toggle, default off), since running the process to convergence
// nSim times per {rule,k} config is meaningfully slower than one static
// tally. Keyed by "<base rule>-dynamic" so configKey()/chart/headline-table
// lookups need no special-casing beyond the runOneConfig dispatch below.
export const DYNAMIC_RULES = ['plurality-dynamic', 'approval-mean-dynamic'];
const DYNAMIC_BASE_RULE = { 'plurality-dynamic': 'plurality', 'approval-mean-dynamic': 'approval-mean' };
export const K_VALUES = [2, 3, 4, 5];

export const DEFAULT_CONFIG = {
  N: 4000, // voter pool size, shared across all configs in a sweep
  nSim: 200, // Monte Carlo iterations per {rule,k} config
  M: 10, // primary candidate slate size (paper's value; user-adjustable, must be >= max(K_VALUES))
  delta: 1.0, // extremist-turnout weight (1 = no bias)
  gamma: 0.0, // primary electability weight (0 = pure ideological distance)
  tau: 0.25, // approval fixed-threshold radius (exploratory, no paper basis)
  lambda: 0.3, // dynamic-process reconsideration proportion per round -- shared with the illustrative draw
  eta: 0.03, // dynamic-process viability tolerance -- shared with the illustrative draw
  alpha: 2, // dynamic-process abandon-probability exponent (1-vr)^alpha -- shared with the illustrative draw
};

export const HEADLINE_CONFIGS = [
  { rule: 'plurality', k: 2, label: 'Plurality top-2 (baseline)' },
  { rule: 'approval-mean', k: 2, label: 'Approval top-2' },
  { rule: 'plurality', k: 3, label: 'Plurality top-3' },
  { rule: 'pav', k: 3, label: 'PAV top-3' },
  { rule: 'approval-mean', k: 3, label: 'Approval top-3' },
];

const VSE_EPS = 1e-9;

function configKey(rule, k) {
  return `${rule}_k${k}`;
}

// Runs one {rule,k} config for nSim iterations against a shared RunContext,
// accumulating sums and dividing once (never per-iteration ratios).
// Dynamic-abandonment rule variants (e.g. 'plurality-dynamic') dispatch to
// runDynamicIteration() against their base rule instead of the static
// one-shot runIteration() -- everything else about the aggregation is
// identical, since both return the same 8-field metrics shape.
function runOneConfig(ctx, rule, k, nSim, rng) {
  const baseRule = DYNAMIC_BASE_RULE[rule];
  const sums = {
    maxC: 0,
    partyDiversity: 0,
    candidateDiversity: 0,
    consensusCapture: 0,
    ccRank: 0,
    winnerUtility: 0,
    randomCandUtility: 0,
    ccUtility: 0,
  };
  for (let i = 0; i < nSim; i++) {
    const m = baseRule
      ? runDynamicIteration(ctx, baseRule, k, rng, { lambda: ctx.config.lambda, eta: ctx.config.eta, alpha: ctx.config.alpha })
      : runIteration(ctx, rule, k, rng);
    sums.maxC += m.maxC;
    sums.partyDiversity += m.partyDiversity;
    sums.candidateDiversity += m.candidateDiversity;
    sums.consensusCapture += m.consensusCapture;
    sums.ccRank += m.ccRank;
    sums.winnerUtility += m.winnerUtility;
    sums.randomCandUtility += m.randomCandUtility;
    sums.ccUtility += m.ccUtility;
  }

  const e = {
    maxC: sums.maxC / nSim,
    partyDiversity: sums.partyDiversity / nSim,
    candidateDiversity: sums.candidateDiversity / nSim,
    consensusCapture: sums.consensusCapture / nSim,
    ccRank: sums.ccRank / nSim,
    winnerUtility: sums.winnerUtility / nSim,
    randomCandUtility: sums.randomCandUtility / nSim,
    ccUtility: sums.ccUtility / nSim,
  };

  const denom = e.ccUtility - e.randomCandUtility;
  const vse = Math.abs(denom) < VSE_EPS ? null : (100 * (e.winnerUtility - e.randomCandUtility)) / denom;
  if (vse === null) {
    console.warn(
      `VSE undefined for ${rule} k=${k}: denominator (E[CC]-E[random]) = ${denom} is below epsilon ${VSE_EPS}.`
    );
  }

  return { ...e, vse, nSim, k, rule };
}

// rulesAndKs: [{rule, k}, ...]. Returns { [rule_kK]: aggregatedResult, ... }.
// One shared pool (per plan's "Decisions resolved": pool sharing across
// sweep configs) is drawn from a seed sub-derived as hashSeed(seed, 'pool');
// each {rule,k} config's own iteration stream is independently derived as
// hashSeed(seed, 'rule_kK'), so any single config is reproducible in
// isolation regardless of sweep composition or run order.
export function runSweep(stateParams, rulesAndKs, config, seed, onProgress) {
  const poolRng = makeRng(hashSeed(seed, 'pool'));
  const ctx = setupRun(stateParams, config, poolRng);

  const results = {};
  for (let idx = 0; idx < rulesAndKs.length; idx++) {
    const { rule, k } = rulesAndKs[idx];
    const key = configKey(rule, k);
    const configRng = makeRng(hashSeed(seed, key));
    results[key] = runOneConfig(ctx, rule, k, config.nSim, configRng);
    if (onProgress) onProgress({ configKey: key, done: idx + 1, total: rulesAndKs.length });
  }
  return results;
}

export function runHeadlineSweep(stateParams, config, seed, onProgress) {
  return runSweep(
    stateParams,
    HEADLINE_CONFIGS.map(({ rule, k }) => ({ rule, k })),
    config,
    seed,
    onProgress
  );
}

// Cartesian {rule,k} list for the full sweep (12 configs at RULES x K_VALUES
// defaults, plus K_VALUES more per rule in `extraRules`). Exported so callers
// driving the Web Worker (ui.js) can request exactly this list without
// duplicating the cartesian-product logic; the headline 3-way comparison is
// always a subset of these same keys, so a single full sweep covers both the
// headline table and the metric-vs-k charts. `extraRules` lets callers
// opt in to OPTIONAL_RULES (e.g. 'pav') without them running by default.
export function fullRulesAndKs(extraRules = []) {
  const rulesAndKs = [];
  for (const rule of [...RULES, ...extraRules]) for (const k of K_VALUES) rulesAndKs.push({ rule, k });
  return rulesAndKs;
}

export function runFullSweep(stateParams, config, seed, onProgress) {
  return runSweep(stateParams, fullRulesAndKs(), config, seed, onProgress);
}

// ---- M-sweep: fixed {rule,k} comparison across primary slate size M --------
//
// Plurality top-2 (baseline) vs. approval top-2 vs. plurality top-3 vs.
// approval top-3, mean-threshold approval only (not the fixed-tau variant --
// tau has no paper basis and isn't part of this comparison), as M varies.
// Unlike RULES/K_VALUES above (many rule/k combos at one fixed M), this
// sweeps M itself against a small fixed set of rule/k combos, so it's a
// separate function rather than an extra fullRulesAndKs() case.
export const M_VALUES = [5, 10, 15, 20, 25];

export const M_SWEEP_RULES_AND_KS = [
  { rule: 'plurality', k: 2 },
  { rule: 'approval-mean', k: 2 },
  { rule: 'plurality', k: 3 },
  { rule: 'approval-mean', k: 3 },
];

// Returns { [M]: { [rule_kK]: aggregatedResult, ... }, ... }. Each M value
// gets its own independent pool + RNG streams (hashSeed(seed, 'M<value>')),
// same as runIllustrativeDraw's per-drawIndex independence -- so no single
// point's randomness leaks into another as M changes.
export function runMSweep(stateParams, config, seed, onProgress) {
  const results = {};
  for (let i = 0; i < M_VALUES.length; i++) {
    const M = M_VALUES[i];
    const mSeed = hashSeed(seed, `M${M}`);
    results[M] = runSweep(stateParams, M_SWEEP_RULES_AND_KS, { ...config, M }, mSeed);
    if (onProgress) onProgress({ done: i + 1, total: M_VALUES.length });
  }
  return results;
}

// One illustrative draw for the "current state/rule/k" chart: its own fresh
// pool (independent of any sweep's shared pool) so a "redraw" button can
// cheaply produce a new draw via drawIndex without perturbing sweep results.
// Runs synchronously on the main thread (main.js/ui.js never routes this
// through the worker -- it's a single iteration, needs to feel instant).
export function runIllustrativeDraw(stateParams, config, seed, rule, k, drawIndex = 0) {
  const label = `illustrative_${drawIndex}`;
  const poolRng = makeRng(hashSeed(seed, `${label}_pool`));
  const ctx = setupRun(stateParams, config, poolRng);
  const iterRng = makeRng(hashSeed(seed, `${label}_${rule}_k${k}`));
  const detail = runIterationDetailed(ctx, rule, k, iterRng);
  return { ctx, detail };
}
