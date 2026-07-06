// Metric-vs-t line chart: x = t (polling round of the dynamic abandonment
// process, docs/js/dynamic-process.js), one panel per metric, single series
// (the process itself -- no legend needed, unlike metric-vs-k-chart.js's
// per-rule series or metric-vs-m-chart.js's fixed rule/k comparison). x is a
// true continuous index (a run can have anywhere from ~5 to ~250 rounds),
// so this uses d3.scaleLinear rather than metric-vs-m-chart.js's
// d3.scalePoint over a small fixed value set.

import { setupSvg, computeYDomain } from './chart-utils.js';

const d3 = window.d3;

// Below this, E[CC]-E[random] is treated as ~0 and VSE is undefined -- same
// threshold used by sweep.js/draw-illustration.js's own local copies of this
// formula (VSE is deliberately duplicated per-caller in this codebase rather
// than centralized, since each caller's inputs come from a different
// aggregation shape).
const VSE_EPS = 1e-9;

function computeStepVse(m) {
  const denom = m.ccUtility - m.randomCandUtility;
  return Math.abs(denom) < VSE_EPS ? null : (100 * (m.winnerUtility - m.randomCandUtility)) / denom;
}

// steps: the dynamic process's per-t snapshot array (each shaped like
// runIterationDetailed()'s return value).
export function renderMetricVsTChart(container, metricMeta, steps, { height = 200 } = {}) {
  const margin = { top: 16, right: 16, bottom: 32, left: 40 };
  const { g, innerWidth, innerHeight } = setupSvg(container, { height, margin });

  const points = steps.map((s, t) => ({
    t,
    value: metricMeta.key === 'vse' ? computeStepVse(s.metrics) : s.metrics[metricMeta.key],
  }));

  const x = d3
    .scaleLinear()
    .domain([0, Math.max(1, steps.length - 1)])
    .range([0, innerWidth]);
  const yDomain = computeYDomain(metricMeta, points.map((p) => p.value));
  const y = d3.scaleLinear().domain(yDomain).range([innerHeight, 0]).nice();

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(Math.min(10, steps.length)).tickFormat(d3.format('d')));
  g.append('g').call(d3.axisLeft(y).ticks(5));

  const line = d3
    .line()
    .defined((d) => d.value != null)
    .x((d) => x(d.t))
    .y((d) => y(d.value));

  g.append('path').datum(points).attr('class', 'metric-line').attr('fill', 'none').attr('stroke', 'var(--accent)').attr('stroke-width', 2).attr('d', line);

  // Circles only for shorter runs -- dense point-markers on a 100+ round
  // process would just clutter the line.
  if (steps.length <= 30) {
    g.selectAll('circle.metric-point')
      .data(points.filter((d) => d.value != null))
      .join('circle')
      .attr('class', 'metric-point')
      .attr('fill', 'var(--accent)')
      .attr('cx', (d) => x(d.t))
      .attr('cy', (d) => y(d.value))
      .attr('r', 3.5);
  }

  const directionNote =
    metricMeta.higherIsBetter === true ? ' (higher is better)' : metricMeta.higherIsBetter === false ? ' (lower is better)' : '';

  g.append('text')
    .attr('class', 'chart-title')
    .attr('x', 0)
    .attr('y', -4)
    .text(metricMeta.label + directionNote);
}
