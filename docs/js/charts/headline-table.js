// 3-way headline comparison table: Plurality-top2 (baseline) vs.
// Approval-mean-top2 vs. Plurality-top3, all 6 metrics, with %-vs-baseline
// (or percentage-point difference at a ~0 baseline, see metrics-meta.js).

import { HEADLINE_CONFIGS } from '../sweep.js';
import { METRICS, formatDelta } from '../metrics-meta.js';

function configKey(c) {
  return `${c.rule}_k${c.k}`;
}

// headlineResults: output of runHeadlineSweep(), keyed "rule_kK".
export function renderHeadlineTable(container, headlineResults) {
  container.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'headline-table';

  const thead = table.createTHead();
  const headRow = thead.insertRow();
  headRow.insertCell().textContent = 'Metric';
  HEADLINE_CONFIGS.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.label;
    headRow.appendChild(th);
  });
  const deltaHeadCell = document.createElement('th');
  deltaHeadCell.textContent = 'Δ PT3-AT2';
  headRow.appendChild(deltaHeadCell);

  const baselineKey = configKey(HEADLINE_CONFIGS[0]);
  const approvalKey = configKey(HEADLINE_CONFIGS[1]);
  const pluralityTop3Key = configKey(HEADLINE_CONFIGS[2]);
  const tbody = table.createTBody();

  METRICS.forEach((meta) => {
    const row = tbody.insertRow();
    const labelCell = row.insertCell();
    labelCell.textContent = meta.label;
    labelCell.className = 'metric-label';

    const rawValues = [];
    const cells = [];

    HEADLINE_CONFIGS.forEach((c, idx) => {
      const key = configKey(c);
      const result = headlineResults[key];
      const value = result ? result[meta.key] : null;
      const cell = row.insertCell();
      rawValues.push(value);
      cells.push(cell);

      if (idx === 0) {
        cell.textContent = meta.format(value);
        cell.className = 'baseline-cell';
      } else {
        const baselineValue = headlineResults[baselineKey] ? headlineResults[baselineKey][meta.key] : null;
        const delta = meta.key === 'vse' && (value == null || baselineValue == null) ? '—' : formatDelta(value, baselineValue);
        cell.innerHTML = `${meta.format(value)} <span class="delta">(${delta})</span>`;
      }
    });

    // Consensus place is the one metric where LOWER is better (rank 1 =
    // the CC topped the primary tally); every other metric is higher-is-better.
    let bestIdx = -1;
    rawValues.forEach((v, idx) => {
      if (v == null) return;
      const isBetter =
        bestIdx === -1 || (meta.higherIsBetter ? v > rawValues[bestIdx] : v < rawValues[bestIdx]);
      if (isBetter) bestIdx = idx;
    });
    if (bestIdx !== -1) {
      const title = meta.higherIsBetter ? 'Highest value among the three methods' : 'Lowest (best) value among the three methods';
      cells[bestIdx].innerHTML += ` <span class="best-check" title="${title}">✅</span>`;
    }

    const approvalValue = headlineResults[approvalKey] ? headlineResults[approvalKey][meta.key] : null;
    const pluralityTop3Value = headlineResults[pluralityTop3Key] ? headlineResults[pluralityTop3Key][meta.key] : null;
    const deltaCell = row.insertCell();
    const compDelta =
      meta.key === 'vse' && (approvalValue == null || pluralityTop3Value == null)
        ? '—'
        : formatDelta(pluralityTop3Value, approvalValue);
    deltaCell.className = 'delta-cell';
    deltaCell.textContent = compDelta;
  });

  container.appendChild(table);
}
