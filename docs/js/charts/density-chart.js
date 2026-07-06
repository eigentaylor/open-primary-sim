// Voter density curve for the selected state's population, combined with the
// illustrative primary draw: candidates are plotted directly on the curve
// (green = advanced to the general, gray = eliminated in the primary, ring =
// general-election winner, diamond = consensus candidate), plus a small
// stacked bar at x=0 showing the state's left/right voter split (from the
// CCES-derived frac_left/frac_right, population-level, distinct from this
// run's finite pool). Dashed lines mark the analytic POPULATION median and
// the finite-POOL median (the one actually used for this draw's primary/
// general-election computations -- see distributions.js's median-distinction
// comment).

import { mixturePdf, mixtureMedianAnalytic } from '../distributions.js';
import { setupSvg, computeXDomain } from './chart-utils.js';

const d3 = window.d3;
const N_POINTS = 300;

// detail/ctx are optional: when omitted (e.g. before the first illustrative
// draw has run), the chart falls back to just the bare density curve.
export function renderDensityChart(container, stateParams, detail = null, ctx = null) {
  const { g, innerWidth, innerHeight } = setupSvg(container, {
    height: 370,
    margin: { top: 64, right: 16, bottom: 76, left: 16 },
  });

  const [xMin, xMax] = computeXDomain(stateParams);
  const points = d3.range(N_POINTS).map((i) => {
    const x = xMin + (i / (N_POINTS - 1)) * (xMax - xMin);
    return { x, y: mixturePdf(x, stateParams) };
  });

  const x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(points, (d) => d.y) * 1.15])
    .range([innerHeight, 0]);

  const area = d3
    .area()
    .x((d) => x(d.x))
    .y0(innerHeight)
    .y1((d) => y(d.y))
    .curve(d3.curveBasis);

  const line = d3
    .line()
    .x((d) => x(d.x))
    .y((d) => y(d.y))
    .curve(d3.curveBasis);

  g.append('path').datum(points).attr('class', 'density-area').attr('d', area);
  g.append('path').datum(points).attr('class', 'density-line').attr('d', line);

  g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(7));

  // Population median (analytic).
  const medianX = mixtureMedianAnalytic(stateParams);
  g.append('line')
    .attr('class', 'median-line population-median')
    .attr('x1', x(medianX))
    .attr('x2', x(medianX))
    .attr('y1', 0)
    .attr('y2', innerHeight);
  g.append('text')
    .attr('class', 'median-label')
    .attr('x', x(medianX))
    .attr('y', -22)
    .attr('text-anchor', 'middle')
    .text(`population median = ${medianX.toFixed(3)}`);

  // Party divide (x=0): the boundary the party-diversity metric checks
  // finalists/voters against.
  const showPartyDivide = xMin < 0 && xMax > 0;
  if (showPartyDivide) {
    g.append('line')
      .attr('class', 'median-line party-line')
      .attr('x1', x(0))
      .attr('x2', x(0))
      .attr('y1', 0)
      .attr('y2', innerHeight);
  }

  // Party-split bar: population-level left/right shares (CCES-derived,
  // stateParams.frac_left/frac_right), straddling x=0 so it reads as "the
  // party balance at the divide" rather than a separate, disconnected stat.
  if (showPartyDivide && stateParams.frac_left != null && stateParams.frac_right != null) {
    const barW = 56;
    const barH = 14;
    const bx = x(0) - barW / 2;
    const by = -46;
    const leftW = barW * stateParams.frac_left;
    g.append('rect')
      .attr('class', 'party-bar party-bar-left')
      .attr('x', bx)
      .attr('y', by)
      .attr('width', leftW)
      .attr('height', barH);
    g.append('rect')
      .attr('class', 'party-bar party-bar-right')
      .attr('x', bx + leftW)
      .attr('y', by)
      .attr('width', barW - leftW)
      .attr('height', barH);
    g.append('text')
      .attr('class', 'party-bar-label')
      .attr('x', x(0))
      .attr('y', by - 4)
      .attr('text-anchor', 'middle')
      .text(`${Math.round(stateParams.frac_left * 100)}% left / ${Math.round(stateParams.frac_right * 100)}% right`);
  }

  // Pool median (this draw's actual winner-selection median).
  if (ctx) {
    g.append('line')
      .attr('class', 'median-line pool-median')
      .attr('x1', x(ctx.xMedianPool))
      .attr('x2', x(ctx.xMedianPool))
      .attr('y1', 0)
      .attr('y2', innerHeight);
    g.append('text')
      .attr('class', 'median-label')
      .attr('x', x(ctx.xMedianPool))
      .attr('y', -6)
      .attr('text-anchor', 'middle')
      .text(`pool median = ${ctx.xMedianPool.toFixed(3)}`);
  }

  // Candidates ON the curve, at (x, pdf(x)).
  if (detail) {
    const candY = (d) => y(mixturePdf(d, stateParams));
    const finalistIdx = new Set(detail.finalists.map((f) => f.originalIndex));
    const winnerIdx = detail.winner.originalIndex;
    const ccIdx = detail.cc.originalIndex;

    g.selectAll('circle.candidate')
      .data(Array.from(detail.candidates))
      .join('circle')
      .attr('class', (d, i) => `candidate ${finalistIdx.has(i) ? 'finalist' : 'eliminated'}`)
      .attr('cx', (d) => x(d))
      .attr('cy', candY)
      .attr('r', (d, i) => (finalistIdx.has(i) ? 7 : 5));

    const ccX = detail.candidates[ccIdx];
    const ccY = candY(ccX);
    g.append('rect')
      .attr('class', 'cc-marker')
      .attr('width', 10)
      .attr('height', 10)
      .attr('x', x(ccX) - 5)
      .attr('y', ccY - 5)
      .attr('transform', `rotate(45, ${x(ccX)}, ${ccY})`);

    const winnerX = detail.candidates[winnerIdx];
    const winnerY = candY(winnerX);
    g.append('circle')
      .attr('class', 'winner-marker')
      .attr('cx', x(winnerX))
      .attr('cy', winnerY)
      .attr('r', 12);

    // Legend (3 cols so the reference-line/bar entries fit alongside the
    // candidate/marker swatches).
    const legend = g.append('g').attr('class', 'draw-legend').attr('transform', `translate(0, ${innerHeight + 22})`);
    const items = [
      { cls: 'legend-finalist', label: 'finalist' },
      { cls: 'legend-eliminated', label: 'eliminated in primary' },
      { cls: 'legend-cc', label: 'consensus candidate (CC)' },
      { cls: 'legend-winner', label: 'general-election winner' },
      { cls: 'legend-population-median', label: 'population median' },
      { cls: 'legend-pool-median', label: 'pool median' },
      { cls: 'legend-party-line', label: 'party divide (x=0)' },
      { cls: 'legend-party-left', label: 'left of x=0 (state share)' },
      { cls: 'legend-party-right', label: 'right of x=0 (state share)' },
    ];
    const perRow = 3;
    const colWidth = innerWidth / perRow;
    items.forEach((it, i) => {
      const lx = (i % perRow) * colWidth;
      const ly = Math.floor(i / perRow) * 16;
      legend.append('rect').attr('class', it.cls).attr('x', lx).attr('y', ly - 8).attr('width', 10).attr('height', 10);
      legend.append('text').attr('x', lx + 14).attr('y', ly + 1).text(it.label);
    });
  }

  return { x, y, xMin, xMax };
}
