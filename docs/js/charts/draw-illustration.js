// One illustrative primary draw: all M candidates on a 1D strip, finalists
// highlighted, the Consensus Candidate starred, the winner ringed, a dashed
// line at the finite-POOL median (distinct from the density chart's
// population median -- this is the median actually used for primary
// utility/winner-selection in this run), a solid line at x=0 (the party
// divide used by the party-diversity metric), and a readout of every
// per-draw metric computed for this single iteration.

import { setupSvg, computeXDomain } from './chart-utils.js';

const d3 = window.d3;

// Below this, E[CC]-E[random] is treated as ~0 and VSE is undefined -- same
// threshold sweep.js uses for the simulation-level VSE (see VSE_EPS there).
// Kept as a local constant since a single draw never shares sweep.js's
// aggregation loop.
const VSE_EPS = 1e-9;

// detail: return value of runIterationDetailed() (candidates/ranking/finalists/winner/cc/metrics)
// ctx: the RunContext from runIllustrativeDraw (has xMedianPool, config.M)
export function renderDrawIllustration(container, detail, ctx, stateParams) {
  const { g, innerWidth, innerHeight } = setupSvg(container, {
    height: 165,
    margin: { top: 28, right: 16, bottom: 56, left: 16 },
  });

  const [xMin, xMax] = computeXDomain(stateParams);
  const x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);
  const midY = innerHeight / 2;

  g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(7));

  const finalistIdx = new Set(detail.finalists.map((f) => f.originalIndex));
  const winnerIdx = detail.winner.originalIndex;
  const ccIdx = detail.cc.originalIndex;

  // Labels stack vertically (rather than sharing y=-4) whenever the party
  // divide and pool median lines land close enough on-screen that their
  // text would otherwise overlap.
  const LABEL_OVERLAP_PX = 70;
  const linesAreClose = Math.abs(x(0) - x(ctx.xMedianPool)) < LABEL_OVERLAP_PX;

  // Party divide (x=0): separates "left" from "right" candidates/voters --
  // the boundary the party-diversity metric checks finalists against.
  if (xMin < 0 && xMax > 0) {
    g.append('line')
      .attr('class', 'median-line party-line')
      .attr('x1', x(0))
      .attr('x2', x(0))
      .attr('y1', 0)
      .attr('y2', innerHeight);
    g.append('text')
      .attr('class', 'median-label party-label')
      .attr('x', x(0))
      .attr('y', linesAreClose ? -16 : -4)
      .attr('text-anchor', 'middle')
      .text('0 (party divide)');
  }

  // Pool median (this run's actual winner-selection median).
  g.append('line')
    .attr('class', 'median-line pool-median')
    .attr('x1', x(ctx.xMedianPool))
    .attr('x2', x(ctx.xMedianPool))
    .attr('y1', 0)
    .attr('y2', innerHeight);
  g.append('text')
    .attr('class', 'median-label')
    .attr('x', x(ctx.xMedianPool))
    .attr('y', -4)
    .attr('text-anchor', 'middle')
    .text(`pool median = ${ctx.xMedianPool.toFixed(3)}`);

  // All M candidates as dots; finalists get a distinct fill.
  g.selectAll('circle.candidate')
    .data(Array.from(detail.candidates))
    .join('circle')
    .attr('class', (d, i) => `candidate ${finalistIdx.has(i) ? 'finalist' : 'eliminated'}`)
    .attr('cx', (d) => x(d))
    .attr('cy', midY)
    .attr('r', (d, i) => (finalistIdx.has(i) ? 7 : 5));

  // CC marker (star-ish: rendered as a distinctly colored diamond via rotated rect).
  const ccX = detail.candidates[ccIdx];
  g.append('rect')
    .attr('class', 'cc-marker')
    .attr('width', 10)
    .attr('height', 10)
    .attr('x', x(ccX) - 5)
    .attr('y', midY - 5)
    .attr('transform', `rotate(45, ${x(ccX)}, ${midY})`);

  // Winner marker: larger ring around their dot.
  const winnerX = detail.candidates[winnerIdx];
  g.append('circle')
    .attr('class', 'winner-marker')
    .attr('cx', x(winnerX))
    .attr('cy', midY)
    .attr('r', 12);

  // Legend (2 rows x 3 cols so the two reference-line entries fit alongside
  // the candidate/marker swatches).
  const legend = g.append('g').attr('class', 'draw-legend').attr('transform', `translate(0, ${innerHeight + 26})`);
  const items = [
    { cls: 'legend-finalist', label: 'finalist' },
    { cls: 'legend-eliminated', label: 'eliminated in primary' },
    { cls: 'legend-cc', label: 'consensus candidate (CC)' },
    { cls: 'legend-winner', label: 'general-election winner' },
    { cls: 'legend-pool-median', label: 'pool median' },
    { cls: 'legend-party-line', label: 'party divide (x=0)' },
  ];
  const perRow = 3;
  const colWidth = innerWidth / perRow;
  items.forEach((it, i) => {
    const lx = (i % perRow) * colWidth;
    const ly = Math.floor(i / perRow) * 16;
    legend.append('rect').attr('class', it.cls).attr('x', lx).attr('y', ly - 8).attr('width', 10).attr('height', 10);
    legend.append('text').attr('x', lx + 14).attr('y', ly + 1).text(it.label);
  });

  renderDrawMetrics(container, detail, ctx);
}

// Per-draw metric readout: every metric computeIterationMetrics() produces,
// for THIS single iteration -- not the simulation-level expectations shown
// in the headline table/metric-vs-k charts below.
function renderDrawMetrics(container, detail, ctx) {
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
