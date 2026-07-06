// Per-draw metric readout for the illustrative primary draw: every metric
// computeIterationMetrics() produces, for THIS single iteration -- not the
// simulation-level expectations shown in the headline table/metric-vs-k
// charts below. (The candidate placements themselves are now drawn directly
// on the voter-distribution curve -- see density-chart.js -- and the vote
// tallies are shown in the toggleable election-results table -- see
// election-results.js.)

import { clearContainer } from './chart-utils.js';

const d3 = window.d3;

// Below this, E[CC]-E[random] is treated as ~0 and VSE is undefined -- same
// threshold sweep.js uses for the simulation-level VSE (see VSE_EPS there).
// Kept as a local constant since a single draw never shares sweep.js's
// aggregation loop.
const VSE_EPS = 1e-9;

// detail: return value of runIterationDetailed() (candidates/ranking/finalists/winner/cc/metrics)
// ctx: the RunContext from runIllustrativeDraw (has xMedianPool, config.M)
export function renderDrawMetrics(container, detail, ctx) {
  const m = detail.metrics;
  const M = ctx.config.M;

  // Single-draw VSE-style score, using the same ratio-of-utilities formula
  // sweep.js applies to simulation-level expectations (see VSE_EPS there).
  // Computed from one iteration's raw utilities, so it's far noisier than
  // the aggregated VSE reported after a full sweep.
  const vseDenom = m.ccUtility - m.randomCandUtility;
  const vse = Math.abs(vseDenom) < VSE_EPS ? null : (100 * (m.winnerUtility - m.randomCandUtility)) / vseDenom;

  const rows = [
    { label: 'Runoff competitiveness (max Cᵢⱼ)', value: m.maxC.toFixed(3) },
    { label: 'Party diverse?', value: m.partyDiversity ? 'Yes' : 'No' },
    { label: 'Candidate diversity (range / σ)', value: m.candidateDiversity.toFixed(3) },
    { label: 'Consensus captured?', value: m.consensusCapture ? 'Yes' : 'No' },
    { label: 'Consensus place', value: `${detail.ccRank} of ${M}` },
    { label: 'VSE (this draw)', value: vse == null ? 'N/A (insufficient spread)' : `${vse.toFixed(1)}%` },
  ];

  clearContainer(container);
  const panel = d3.select(container).append('div').attr('class', 'draw-metrics');
  panel
    .selectAll('div.draw-metric')
    .data(rows)
    .join('div')
    .attr('class', 'draw-metric')
    .html((d) => `<span class="draw-metric-label">${d.label}</span><span class="draw-metric-value">${d.value}</span>`);
  panel
    .append('p')
    .attr('class', 'draw-metric-note')
    .text('Single-draw values, noisy by construction -- see the headline table and per-metric charts below for simulation-level expectations over nSim draws.');
}
