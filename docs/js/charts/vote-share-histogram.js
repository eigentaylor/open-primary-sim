// Vote-share histogram: a third view for the election-results section
// (alongside Primary/General), showing every candidate's vote share as a
// descending bar (data is already sorted -- detail.ranking is pre-sorted
// descending by tally value). Available for both the static single-shot
// draw and the dynamic abandonment process's per-t snapshots -- this is a
// general-purpose view, not gated by dynamic mode. When scrubbing through
// the dynamic process's t-slider, this is the clearest way to see
// abandonment/clustering happen over time.

import { totalWeight } from '../simulate.js';
import { setupSvg, partyClass, PARTY_NOTE } from './chart-utils.js';

const d3 = window.d3;

const FINALIST_LETTERS = 'ABCDE';

// A bar's FILL is the candidate's party (left/right of x=0, see
// chart-utils.js's partyClass) so consolidation behind a frontrunner reads
// as a same-color cluster; finalist/eliminated is now an opacity overlay
// (full vs faded) instead of its own hue, plus optional CC/winner STROKE
// overlays -- mirrors density-chart.js's convention of a base fill with
// separate cc-marker/winner-marker overlays, rather than one mutually-
// exclusive role.
function barClasses(entry, detail) {
  const isFinalist = detail.finalists.some((f) => f.originalIndex === entry.originalIndex);
  const classes = [isFinalist ? 'bar-finalist' : 'bar-eliminated', partyClass(entry.candidateX)];
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

  // Winner halo: drawn before (under) the main bars so its white outline
  // sits behind the winner's own colored stroke -- keeps the winner visible
  // even when their bar is party-right (same red as --winner).
  g.selectAll('rect.vote-share-bar-halo')
    .data(rows.filter((d) => d.classes.includes('bar-winner')))
    .join('rect')
    .attr('class', 'vote-share-bar-halo')
    .attr('x', (d) => x(d.place))
    .attr('y', (d) => y(d.pct))
    .attr('width', x.bandwidth())
    .attr('height', (d) => innerHeight - y(d.pct));

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

  d3.select(container).append('p').attr('class', 'results-note').text(PARTY_NOTE);
}
