// Voter density curve for the selected state's population, with a dashed
// line at the analytic POPULATION median (distinct from the finite-pool
// median used for primary/general-election computations -- see
// distributions.js's median-distinction comment).

import { mixturePdf, mixtureMedianAnalytic } from '../distributions.js';
import { setupSvg, computeXDomain } from './chart-utils.js';

const d3 = window.d3;
const N_POINTS = 300;

export function renderDensityChart(container, stateParams) {
  const { g, innerWidth, innerHeight } = setupSvg(container, { height: 200 });

  const [xMin, xMax] = computeXDomain(stateParams);
  const points = d3.range(N_POINTS).map((i) => {
    const x = xMin + (i / (N_POINTS - 1)) * (xMax - xMin);
    return { x, y: mixturePdf(x, stateParams) };
  });

  const x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(points, (d) => d.y) * 1.1])
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
    .attr('y', -4)
    .attr('text-anchor', 'middle')
    .text(`population median = ${medianX.toFixed(3)}`);

  return { x, xMin, xMax };
}
