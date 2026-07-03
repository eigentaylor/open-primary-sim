// Generic metric-vs-k line chart: x = k in {2,3,4,5}, one line per active
// primary rule (plurality / approval-mean / approval-tau, plus pav when the
// "Use PAV" toggle is on). One function parameterized by metric key, called
// once per metric (6 small multiples), rather than 6 bespoke chart functions.

import { K_VALUES } from '../sweep.js';
import { setupSvg, computeYDomain } from './chart-utils.js';

const d3 = window.d3;

const RULE_LABELS = {
  plurality: 'Plurality',
  'approval-mean': 'Approval (mean threshold)',
  'approval-tau': 'Approval (fixed τ)',
  pav: 'PAV (proportional approval)',
};

// Fixed per-rule colors (not positional) so toggling PAV on/off never
// reshuffles the other rules' colors.
const RULE_COLORS = {
  plurality: '#2563eb',
  'approval-mean': '#16a34a',
  'approval-tau': '#d97706',
  pav: '#9333ea',
};

// Reserved below the x-axis for the in-chart legend, in viewBox units --
// independent of on-screen size, since the legend is drawn as SVG (not
// HTML) so it scales with the chart instead of overwhelming small multiples.
const LEGEND_GAP = 10;
const LEGEND_ROW_HEIGHT = 16;
const LEGEND_MAX_ROWS = 2;
const LEGEND_BLOCK_HEIGHT = LEGEND_GAP + LEGEND_ROW_HEIGHT * LEGEND_MAX_ROWS;

// sweepResults: output of runFullSweep(), keyed "rule_kK". `rules`: the
// currently-active rule list (see ui.js's activeRules()). `mValue`: the
// primary candidate slate size (M) the sweep was run with, shown on the
// chart since it materially changes the curves but isn't otherwise visible
// once you're looking at an individual panel.
export function renderMetricVsKChart(container, metricMeta, sweepResults, rules, { height = 200, mValue } = {}) {
  const baseMargin = { top: 16, right: 16, bottom: 32, left: 40 };
  const { g, innerWidth, innerHeight } = setupSvg(container, {
    height: height + LEGEND_BLOCK_HEIGHT,
    margin: { ...baseMargin, bottom: baseMargin.bottom + LEGEND_BLOCK_HEIGHT },
  });

  const x = d3.scalePoint().domain(K_VALUES).range([0, innerWidth]).padding(0.5);

  const series = rules.map((rule) => ({
    rule,
    points: K_VALUES.map((k) => {
      const r = sweepResults[`${rule}_k${k}`];
      return { k, value: r ? r[metricMeta.key] : null };
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
    .x((d) => x(d.k))
    .y((d) => y(d.value));

  series.forEach((s) => {
    g.append('path')
      .datum(s.points)
      .attr('class', `metric-line rule-${s.rule}`)
      .attr('fill', 'none')
      .attr('stroke', RULE_COLORS[s.rule])
      .attr('stroke-width', 2)
      .attr('d', line);

    g.selectAll(`circle.pt-${s.rule.replace(/[^a-z]/g, '')}`)
      .data(s.points.filter((d) => d.value != null))
      .join('circle')
      .attr('class', `metric-point rule-${s.rule}`)
      .attr('fill', RULE_COLORS[s.rule])
      .attr('cx', (d) => x(d.k))
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

  if (mValue != null) {
    g.append('text')
      .attr('class', 'chart-subtitle')
      .attr('x', innerWidth)
      .attr('y', -4)
      .attr('text-anchor', 'end')
      .text(`M = ${mValue}`);
  }

  renderInChartLegend(g, rules, innerWidth, innerHeight);

  return { ruleLabels: RULE_LABELS };
}

// Wraps rule swatches/labels onto up to LEGEND_MAX_ROWS lines below the
// x-axis, measuring each item's actual rendered width via getBBox() rather
// than guessing at character widths.
function renderInChartLegend(g, rules, innerWidth, innerHeight) {
  const swatchRadius = 4;
  const swatchTextGap = 5;
  const itemGap = 14;
  let x = 0;
  let y = innerHeight + 32 + LEGEND_GAP;

  rules.forEach((rule) => {
    const item = g.append('g').attr('class', 'chart-legend-item');
    item.append('circle').attr('r', swatchRadius).attr('fill', RULE_COLORS[rule]);
    item
      .append('text')
      .attr('class', 'legend-label')
      .attr('x', swatchRadius * 2 + swatchTextGap)
      .attr('dominant-baseline', 'middle')
      .text(RULE_LABELS[rule]);

    const itemWidth = item.node().getBBox().width;
    if (x > 0 && x + itemWidth > innerWidth) {
      x = 0;
      y += LEGEND_ROW_HEIGHT;
    }
    item.attr('transform', `translate(${x},${y})`);
    x += itemWidth + itemGap;
  });
}

export function renderSharedLegend(container, rules) {
  const legend = d3.select(container).append('div').attr('class', 'shared-legend');
  rules.forEach((rule) => {
    const item = legend.append('span').attr('class', 'legend-item');
    item.append('span').attr('class', 'legend-swatch').style('background', RULE_COLORS[rule]);
    item.append('span').text(RULE_LABELS[rule]);
  });
}
