// Vote-share histogram: a third view for the election-results section
// (alongside Primary/General), showing every candidate's vote share as a
// descending bar (data is already sorted -- detail.ranking is pre-sorted
// descending by tally value). Available for both the static single-shot
// draw and the dynamic abandonment process's per-t snapshots -- this is a
// general-purpose view, not gated by dynamic mode. When scrubbing through
// the dynamic process's t-slider, this is the clearest way to see
// abandonment/clustering happen over time.

import { totalWeight } from '../simulate.js';
import { setupSvg } from './chart-utils.js';

const d3 = window.d3;

const FINALIST_LETTERS = 'ABCDE';

// A bar always gets exactly one FILL class (finalist/eliminated), plus
// optional CC/winner STROKE overlays -- mirrors density-chart.js's
// convention of a finalist/eliminated circle fill with separate cc-marker/
// winner-marker overlays, rather than one mutually-exclusive role.
function barClasses(entry, detail) {
  const isFinalist = detail.finalists.some((f) => f.originalIndex === entry.originalIndex);
  const classes = [isFinalist ? 'bar-finalist' : 'bar-eliminated'];
  if (entry.originalIndex === detail.cc.originalIndex) classes.push('bar-cc');
  if (entry.originalIndex === detail.winner.originalIndex) classes.push('bar-winner');
  return classes.join(' ');
}

// detail/ctx: same shapes renderDensityChart()/renderElectionResults() take.
// letterMap: optional Map(originalIndex -> letter); when null, derives fresh
// from detail.finalists (matching election-results.js's fallback convention).
export function renderVoteShareHistogram(container, detail, ctx, letterMap = null, { height = 240 } = {}) {
  const tw = totalWeight(ctx);
  const ranking = detail.ranking;
  const letters = letterMap || new Map(detail.finalists.map((f, i) => [f.originalIndex, FINALIST_LETTERS[i]]));

  const rows = ranking.map((entry, i) => ({
    place: i + 1,
    originalIndex: entry.originalIndex,
    pct: (entry.tallyValue / tw) * 100,
    letter: letters.get(entry.originalIndex) || null,
    classes: barClasses(entry, detail),
  }));

  const margin = { top: 28, right: 16, bottom: 32, left: 44 };
  const { g, innerWidth, innerHeight } = setupSvg(container, { height, margin });

  const x = d3
    .scaleBand()
    .domain(rows.map((d) => d.place))
    .range([0, innerWidth])
    .padding(0.15);

  const maxPct = d3.max(rows, (d) => d.pct) || 0;
  const y = d3
    .scaleLinear()
    .domain([0, Math.max(100, maxPct) * 1.08])
    .range([innerHeight, 0]);

  // Sparse x-axis ticks: at most ~20 labels even at M=61.
  const tickStep = Math.max(1, Math.ceil(rows.length / 20));
  const tickValues = rows.filter((d, i) => i % tickStep === 0).map((d) => d.place);
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(tickValues));
  g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${d}%`));

  const bars = g
    .selectAll('rect.vote-share-bar')
    .data(rows)
    .join('rect')
    .attr('class', (d) => `vote-share-bar ${d.classes}`)
    .attr('x', (d) => x(d.place))
    .attr('y', (d) => y(d.pct))
    .attr('width', x.bandwidth())
    .attr('height', (d) => innerHeight - y(d.pct));
  bars.append('title').text((d) => `#${d.place}: ${d.pct.toFixed(1)}% of voters`);

  g.selectAll('text.hist-label')
    .data(rows.filter((d) => d.letter))
    .join('text')
    .attr('class', 'hist-label')
    .attr('x', (d) => x(d.place) + x.bandwidth() / 2)
    .attr('y', (d) => y(d.pct) - 4)
    .attr('text-anchor', 'middle')
    .text((d) => d.letter);

  g.append('text').attr('class', 'chart-title').attr('x', 0).attr('y', -10).text('Vote shares by rank (sorted descending)');
}
