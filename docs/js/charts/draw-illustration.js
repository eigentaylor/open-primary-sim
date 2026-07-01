// One illustrative primary draw: all M candidates on a 1D strip, finalists
// highlighted, the Consensus Candidate starred, the winner ringed, and a
// dashed line at the finite-POOL median (distinct from the density chart's
// population median -- this is the median actually used for primary
// utility/winner-selection in this run).

import { setupSvg, computeXDomain } from './chart-utils.js';

const d3 = window.d3;

// detail: return value of runIterationDetailed() (candidates/ranking/finalists/winner/cc)
// ctx: the RunContext from runIllustrativeDraw (has xMedianPool)
export function renderDrawIllustration(container, detail, ctx, stateParams) {
  const { g, innerWidth, innerHeight } = setupSvg(container, { height: 140 });

  const [xMin, xMax] = computeXDomain(stateParams);
  const x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);
  const midY = innerHeight / 2;

  g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(7));

  const finalistIdx = new Set(detail.finalists.map((f) => f.originalIndex));
  const winnerIdx = detail.winner.originalIndex;
  const ccIdx = detail.cc.originalIndex;

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

  // Legend.
  const legend = g.append('g').attr('class', 'draw-legend').attr('transform', `translate(0, ${innerHeight + 26})`);
  const items = [
    { cls: 'legend-finalist', label: 'finalist' },
    { cls: 'legend-eliminated', label: 'eliminated in primary' },
    { cls: 'legend-cc', label: 'consensus candidate (CC)' },
    { cls: 'legend-winner', label: 'general-election winner' },
  ];
  items.forEach((it, i) => {
    const lx = i * 150;
    legend.append('rect').attr('class', it.cls).attr('x', lx).attr('y', -8).attr('width', 10).attr('height', 10);
    legend.append('text').attr('x', lx + 14).attr('y', 1).text(it.label);
  });
}
