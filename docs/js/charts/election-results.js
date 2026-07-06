// Election-results display for the current illustrative draw, toggled by
// the caller (ui.js) between two views:
//   - primary: place/votes/% for every M candidate (full ranking).
//   - general: every pairwise (Condorcet) matchup among the k finalists --
//     not a single aggregate tally, since a plurality-style count across
//     3+ finalists is vulnerable to vote-splitting in a way a genuine
//     head-to-head count isn't (see simulate.js's generalMatchups comment).
//     Finalists are labeled A, B, C... (in primary-tally order) so the same
//     candidate can be tracked across multiple matchups and back to their
//     row in the primary table.
//
// Approval primaries let one voter approve multiple candidates, so primary
// percentages can legitimately sum to more than 100% -- that's real
// behavior (see primary-rules.js's approvalTallyMean), not a bug, and is
// called out under the table when the active rule is approval-based.

import { totalWeight } from '../simulate.js';

const d3 = window.d3;

const FINALIST_LETTERS = 'ABCDE';

function isApprovalRule(rule) {
  return rule === 'approval-mean' || rule === 'approval-tau' || rule === 'pav';
}

// letterMap: optional externally-supplied Map(originalIndex -> letter). When
// null, derives fresh from detail.finalists (today's behavior, in
// primary-tally order). Supplying a fixed map lets a caller (the dynamic
// abandonment process) keep letters stable across every t snapshot, based
// on the FINAL round's finalists rather than whichever candidates are
// finalists at the currently-viewed t -- "advanced" stays driven by the
// CURRENT detail.finalists membership regardless of where the letters came
// from, so a candidate can be lettered without (yet) showing "Advances".
function buildPrimaryRows(detail, ctx, letterMap = null) {
  const tw = totalWeight(ctx);
  const currentFinalistIdx = new Set(detail.finalists.map((f) => f.originalIndex));
  const letters = letterMap || new Map(detail.finalists.map((f, i) => [f.originalIndex, FINALIST_LETTERS[i]]));
  return detail.ranking.map((entry, i) => ({
    place: i + 1,
    originalIndex: entry.originalIndex,
    candidateX: entry.candidateX,
    votes: entry.tallyValue,
    pct: (entry.tallyValue / tw) * 100,
    letter: letters.get(entry.originalIndex) || null,
    advanced: currentFinalistIdx.has(entry.originalIndex),
    isWinner: entry.originalIndex === detail.winner.originalIndex,
    isCC: entry.originalIndex === detail.cc.originalIndex,
  }));
}

function rowClass(d) {
  const classes = ['results-row'];
  if (d.isWinner) classes.push('winner-row');
  if (d.isCC) classes.push('cc-row');
  return classes.join(' ');
}

function candidateCellHtml(d) {
  const swatchClass = d.advanced ? 'legend-finalist' : 'legend-eliminated';
  const letterPrefix = d.letter ? `<strong>${d.letter}</strong> &middot; ` : '';
  let html = `<span class="results-swatch ${swatchClass}"></span>${letterPrefix}x = ${d.candidateX.toFixed(3)}`;
  if (d.advanced) html += ' <span class="results-badge advanced-badge">Advances</span>';
  if (d.isCC) html += ' <span class="results-badge cc-badge">CC</span>';
  if (d.isWinner) html += ' <span class="results-badge winner-badge">Winner</span>';
  return html;
}

function renderPrimaryTable(wrap, detail, ctx, rule, letterMap) {
  const rows = buildPrimaryRows(detail, ctx, letterMap);

  const table = wrap.append('table').attr('class', 'results-table');
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Place', 'Candidate', 'Votes', '% of voters'])
    .join('th')
    .text((d) => d);

  const tr = table.append('tbody').selectAll('tr').data(rows).join('tr').attr('class', rowClass);
  tr.append('td').attr('class', 'results-place').text((d) => d.place);
  tr.append('td').attr('class', 'results-candidate').html(candidateCellHtml);
  tr.append('td').attr('class', 'results-votes').text((d) => Math.round(d.votes).toLocaleString());
  tr.append('td').attr('class', 'results-pct').text((d) => `${d.pct.toFixed(1)}%`);

  if (isApprovalRule(rule)) {
    wrap
      .append('p')
      .attr('class', 'results-note')
      .text('Approval primary -- voters may approve more than one candidate, so percentages can add up to more than 100%.');
  }
}

// Every k-choose-2 pairwise matchup among the finalists, letter-labeled and
// carrying enough of the primary-table's candidate metadata (CC/overall-
// winner) to render standalone.
function buildGeneralMatchups(detail, ctx, letterMap = null) {
  const tw = totalWeight(ctx);
  const winnerOriginalIndex = detail.winner.originalIndex;
  const ccOriginalIndex = detail.cc.originalIndex;
  const letters = letterMap || new Map(detail.finalists.map((f, i) => [f.originalIndex, FINALIST_LETTERS[i]]));

  const side = (candidateX, originalIndex, votes) => ({
    candidateX,
    originalIndex,
    letter: letters.get(originalIndex) || null,
    votes,
    pct: (votes / tw) * 100,
    isOverallWinner: originalIndex === winnerOriginalIndex,
    isCC: originalIndex === ccOriginalIndex,
  });

  const matchups = detail.generalMatchups.map((m) => {
    const a = side(detail.finalists[m.aIndex].candidateX, m.aOriginalIndex, m.aVotes);
    const b = side(detail.finalists[m.bIndex].candidateX, m.bOriginalIndex, m.bVotes);
    const margin = Math.abs(a.pct - b.pct);
    if (a.votes >= b.votes) a.isMatchupWinner = true;
    else b.isMatchupWinner = true;
    return {
      a,
      b,
      margin,
      involvesOverallWinner: a.isOverallWinner || b.isOverallWinner,
    };
  });

  // Winner's matchups first (they're the ones that explain why they won),
  // then the rest -- closest margin first within each group.
  matchups.sort((x, y) => {
    if (x.involvesOverallWinner !== y.involvesOverallWinner) return x.involvesOverallWinner ? -1 : 1;
    return x.margin - y.margin;
  });
  return matchups;
}

function matchupSideHtml(side) {
  // letter can be null when viewing an earlier t of the dynamic process
  // whose current-t finalists aren't a subset of the FINAL round's lettered
  // finalists -- fall back to the candidate's position instead of "null".
  const letterPrefix = side.letter ? `<strong>${side.letter}</strong> &middot; ` : '';
  let html = `<span class="results-swatch legend-finalist"></span>${letterPrefix}x = ${side.candidateX.toFixed(3)}`;
  if (side.isCC) html += ' <span class="results-badge cc-badge">CC</span>';
  if (side.isOverallWinner) html += ' <span class="results-badge winner-badge">Winner</span>';
  return html;
}

function renderGeneralMatchups(wrap, detail, ctx, letterMap) {
  const matchups = buildGeneralMatchups(detail, ctx, letterMap);

  const list = wrap.append('div').attr('class', 'matchup-list');
  const blocks = list.selectAll('div.matchup-block').data(matchups).join('div').attr('class', 'matchup-block');

  blocks
    .append('div')
    .attr('class', 'matchup-heading')
    .html(
      (d) =>
        `${d.a.letter || `x=${d.a.candidateX.toFixed(3)}`} vs ${d.b.letter || `x=${d.b.candidateX.toFixed(3)}`} ` +
        `<span class="matchup-margin">margin ${d.margin.toFixed(1)} pts</span>`
    );

  const table = blocks.append('table').attr('class', 'results-table matchup-table');
  table
    .append('thead')
    .append('tr')
    .selectAll('th')
    .data(['Candidate', 'Votes', '% of voters'])
    .join('th')
    .text((d) => d);
  const tbody = table.append('tbody');
  const tr = tbody
    .selectAll('tr')
    .data((d) => [d.a, d.b])
    .join('tr')
    .attr('class', (d) => `results-row matchup-row${d.isMatchupWinner ? ' matchup-winner' : ''}`);
  tr.append('td').attr('class', 'results-candidate').html(matchupSideHtml);
  tr.append('td').attr('class', 'results-votes').text((d) => Math.round(d.votes).toLocaleString());
  tr.append('td').attr('class', 'results-pct').text((d) => `${d.pct.toFixed(1)}%`);

  wrap
    .append('p')
    .attr('class', 'results-note')
    .text(
      'General election runs under the Condorcet rule: every pairwise matchup among the finalists is shown, ' +
        'the overall winner’s matchups first, closest margin first within each group. The overall winner beats every other finalist head-to-head.'
    );
}

// detail/ctx: same shapes as density-chart.js/draw-illustration.js take.
// view: 'primary' | 'general'. rule: the active primary rule (for the
// approval sum-to->100% note). letterMap: optional Map(originalIndex ->
// letter) overriding the default "derive from this detail's finalists"
// behavior -- supplied by the dynamic abandonment process so letters stay
// fixed (based on the FINAL round's finalists) across every t snapshot;
// null/omitted preserves the static single-draw path's existing behavior.
export function renderElectionResults(container, detail, ctx, view, rule, letterMap = null) {
  const wrap = d3.select(container);
  wrap.selectAll('*').remove();

  if (view === 'general') renderGeneralMatchups(wrap, detail, ctx, letterMap);
  else renderPrimaryTable(wrap, detail, ctx, rule, letterMap);
}
