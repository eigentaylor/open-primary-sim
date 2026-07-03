// Generic metric-vs-k line chart: x = k in {2,3,4,5}, one line per active
// primary rule (plurality / approval-mean / approval-tau, plus pav when the
// "Use PAV" toggle is on). One function parameterized by metric key, called
// once per metric (6 small multiples), rather than 6 bespoke chart functions.

import { K_VALUES } from '../sweep.js';
import { setupSvg } from './chart-utils.js';

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

// sweepResults: output of runFullSweep(), keyed "rule_kK". `rules`: the
// currently-active rule list (see ui.js's activeRules()).
export function renderMetricVsKChart(container, metricMeta, sweepResults, rules, { height = 200 } = {}) {
  const { g, innerWidth, innerHeight } = setupSvg(container, { height, margin: { top: 16, right: 16, bottom: 32, left: 40 } });

  const x = d3.scalePoint().domain(K_VALUES).range([0, innerWidth]).padding(0.5);

  const series = rules.map((rule) => ({
    rule,
    points: K_VALUES.map((k) => {
      const r = sweepResults[`${rule}_k${k}`];
      return { k, value: r ? r[metricMeta.key] : null };
    }),
  }));

  let yDomain = metricMeta.domain;
  if (!yDomain) {
    const allVals = series.flatMap((s) => s.points.map((p) => p.value)).filter((v) => v != null);
    const lo = Math.min(...allVals, 0);
    const hi = Math.max(...allVals, 1);
    yDomain = [lo, hi * 1.05];
  }
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

  renderLegendItems(container, rules);

  return { ruleLabels: RULE_LABELS };
}

function renderLegendItems(container, rules, className = 'chart-legend') {
  const legend = d3.select(container).append('div').attr('class', className);
  rules.forEach((rule) => {
    const item = legend.append('span').attr('class', 'legend-item');
    item.append('span').attr('class', 'legend-swatch').style('background', RULE_COLORS[rule]);
    item.append('span').text(RULE_LABELS[rule]);
  });
}

export function renderSharedLegend(container, rules) {
  renderLegendItems(container, rules, 'shared-legend');
}
