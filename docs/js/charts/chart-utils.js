// Small shared helpers for the D3 chart modules: SVG boilerplate and a
// consistent x-domain so the density chart and the illustrative draw chart
// can be stacked with a shared x-scale.

const d3 = window.d3;

export function clearContainer(container) {
  container.innerHTML = '';
}

export function setupSvg(container, { width = 640, height = 220, margin = { top: 16, right: 16, bottom: 32, left: 16 } } = {}) {
  clearContainer(container);
  const svg = d3.select(container).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${width} ${height}`);
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  return { svg, g, innerWidth, innerHeight, margin, width, height };
}

// x-domain spanning the state's mixture components, wide enough to show
// both tails without being dominated by extreme bracket margins used for
// the median bisection solver's numerical safety.
export function computeXDomain(stateParams) {
  const muMin = Math.min(...stateParams.mu);
  const muMax = Math.max(...stateParams.mu);
  const sigMax = Math.max(...stateParams.sigma);
  return [muMin - 4 * sigMax, muMax + 4 * sigMax];
}

// Per-candidate party color: which side of the state's left/right divide
// (x=0 -- the same boundary partyDiversity/density-chart's party-line check)
// a candidate sits on. A stand-in for D/R, not a real party label -- lets
// same-side candidates read as a visual cluster (e.g. consolidation behind
// a frontrunner in the vote-share histogram).
export function partyClass(candidateX) {
  return candidateX < 0 ? 'party-left' : 'party-right';
}

export const PARTY_NOTE =
  "Color shows which side of the state's left/right divide (x=0) each candidate falls on -- blue = left, red = right (a stand-in for D/R, not a literal party label).";

// y-domain for the metric-vs-k/M small multiples. metricMeta.domain (if
// set) is a fixed axis, used verbatim -- for probability-like metrics where
// the absolute 0-1 scale is meaningful. Otherwise the axis fits the actual
// spread of the plotted values (rather than always spanning down to 0 / up
// to 1), so results that cluster together aren't squashed into a sliver of
// the chart. metricMeta.yFloor pins the lower bound instead of the data min,
// for metrics with a real floor the data might not reach (e.g. rank-based
// metrics, which can't go below 1).
export function computeYDomain(metricMeta, allVals) {
  if (metricMeta.domain) return metricMeta.domain;
  const vals = allVals.filter((v) => v != null);
  const dataLo = Math.min(...vals);
  const dataHi = Math.max(...vals);
  const span = dataHi - dataLo || Math.abs(dataHi) || 1;
  const pad = span * 0.08;
  const lo = metricMeta.yFloor != null ? metricMeta.yFloor : dataLo - pad;
  const hi = dataHi + pad;
  return [lo, hi];
}
