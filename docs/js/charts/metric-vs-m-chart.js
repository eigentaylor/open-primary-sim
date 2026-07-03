// Metric-vs-M line chart: x = M (primary candidate slate size) in
// sweep.js's M_VALUES, one line per fixed rule/k comparison -- approval
// top-2 vs. plurality top-3 (always shown) vs. approval top-3 (optional,
// on by default). Mean-threshold approval only, not fixed-tau. Structurally
// mirrors metric-vs-k-chart.js (same small-multiple-per-metric approach)
// but the series set here is a fixed 3-way comparison rather than
// "whichever rules are active", so it's a separate module.

import { M_VALUES } from '../sweep.js';
import { setupSvg, computeYDomain } from './chart-utils.js';

const d3 = window.d3;

export const M_SERIES = [
  { key: 'approval-mean_k2', shortLabel: 'AT2', label: 'Approval top-2 (mean threshold)', optional: false },
  { key: 'plurality_k3', shortLabel: 'PT3', label: 'Plurality top-3', optional: false },
  { key: 'approval-mean_k3', shortLabel: 'AT3', label: 'Approval top-3 (mean threshold)', optional: true },
];

// Fixed per-series colors (not positional), same rationale as
// metric-vs-k-chart.js's RULE_COLORS: toggling AT3 on/off never reshuffles
// AT2/PT3's colors.
const SERIES_COLORS = {
  'approval-mean_k2': '#16a34a',
  plurality_k3: '#2563eb',
  'approval-mean_k3': '#d97706',
};

const LEGEND_GAP = 10;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_MAX_ROWS = 2;
const LEGEND_BLOCK_HEIGHT = LEGEND_GAP + LEGEND_ROW_HEIGHT * LEGEND_MAX_ROWS;

// mSweepResults: output of runMSweep(), keyed [M][rule_kK]. `seriesKeys`: the
// currently-active series (AT3 filtered out when its toggle is off).
export function renderMetricVsMChart(container, metricMeta, mSweepResults, seriesKeys, { height = 200 } = {}) {
  const baseMargin = { top: 16, right: 16, bottom: 32, left: 40 };
  const { g, innerWidth, innerHeight } = setupSvg(container, {
    height: height + LEGEND_BLOCK_HEIGHT,
    margin: { ...baseMargin, bottom: baseMargin.bottom + LEGEND_BLOCK_HEIGHT },
  });

  const x = d3.scalePoint().domain(M_VALUES).range([0, innerWidth]).padding(0.5);

  const series = seriesKeys.map((key) => ({
    key,
    points: M_VALUES.map((M) => {
      const r = mSweepResults[M] && mSweepResults[M][key];
      return { M, value: r ? r[metricMeta.key] : null };
    }),
  }));

  const allVals = series.flatMap((s) => s.points.map((p) => p.value));
  const yDomain = computeYDomain(metricMeta, allVals);
  const y = d3.scaleLinear().domain(yDomain).range([innerHeight, 0]).nice();

  g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y).ticks(5));

  const line = d3
    .line()
    .defined((d) => d.value != null)
    .x((d) => x(d.M))
    .y((d) => y(d.value));

  series.forEach((s) => {
    g.append('path')
      .datum(s.points)
      .attr('class', `metric-line series-${s.key}`)
      .attr('fill', 'none')
      .attr('stroke', SERIES_COLORS[s.key])
      .attr('stroke-width', 2)
      .attr('d', line);

    g.selectAll(`circle.pt-${s.key.replace(/[^a-z]/gi, '')}`)
      .data(s.points.filter((d) => d.value != null))
      .join('circle')
      .attr('class', `metric-point series-${s.key}`)
      .attr('fill', SERIES_COLORS[s.key])
      .attr('cx', (d) => x(d.M))
      .attr('cy', (d) => y(d.value))
      .attr('r', 3.5);
  });

  const directionNote =
    metricMeta.higherIsBetter === true ? ' (higher is better)' : metricMeta.higherIsBetter === false ? ' (lower is better)' : '';

  g.append('text')
    .attr('class', 'chart-title')
    .attr('x', 0)
    .attr('y', -4)
    .text(metricMeta.label + directionNote);

  renderInChartLegend(g, seriesKeys, innerWidth, innerHeight);
}

// Wraps series swatches/labels onto up to LEGEND_MAX_ROWS lines below the
// x-axis, measuring each item's actual rendered width via getBBox() rather
// than guessing at character widths (same approach as metric-vs-k-chart.js).
function renderInChartLegend(g, seriesKeys, innerWidth, innerHeight) {
  const labelByKey = Object.fromEntries(M_SERIES.map((s) => [s.key, s.shortLabel]));
  const swatchRadius = 4;
  const swatchTextGap = 5;
  const itemGap = 14;
  let x = 0;
  let y = innerHeight + 32 + LEGEND_GAP;

  seriesKeys.forEach((key) => {
    const item = g.append('g').attr('class', 'chart-legend-item');
    item.append('circle').attr('r', swatchRadius).attr('fill', SERIES_COLORS[key]);
    item
      .append('text')
      .attr('class', 'legend-label')
      .attr('x', swatchRadius * 2 + swatchTextGap)
      .attr('dominant-baseline', 'middle')
      .text(labelByKey[key]);

    const itemWidth = item.node().getBBox().width;
    if (x > 0 && x + itemWidth > innerWidth) {
      x = 0;
      y += LEGEND_ROW_HEIGHT;
    }
    item.attr('transform', `translate(${x},${y})`);
    x += itemWidth + itemGap;
  });
}

export function renderSharedLegend(container, seriesKeys) {
  const labelByKey = Object.fromEntries(M_SERIES.map((s) => [s.key, s.label]));
  const legend = d3.select(container).append('div').attr('class', 'shared-legend');
  seriesKeys.forEach((key) => {
    const item = legend.append('span').attr('class', 'legend-item');
    item.append('span').attr('class', 'legend-swatch').style('background', SERIES_COLORS[key]);
    item.append('span').text(labelByKey[key]);
  });
}
