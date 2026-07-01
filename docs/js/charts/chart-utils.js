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
