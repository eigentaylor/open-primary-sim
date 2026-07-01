// Headline comparison table: Plurality-top2 (baseline) vs. Approval-top2 vs.
// Plurality-top3, all 6 metrics, with %-vs-baseline (or percentage-point
// difference at a ~0 baseline, see metrics-meta.js). Approval-top3 is an
// optional 4th column, off by default. The rightmost "Δ" column subtracts
// any two shown columns, chosen via the dropdowns (default PT3 − AT2).

import { METRICS, formatDelta } from '../metrics-meta.js';

// Fixed catalog of columns this table knows how to show. `key` matches the
// "rule_kK" keys produced by runSweep/runFullSweep. Order here is display
// order; the first entry is always the baseline and is never hidden.
const COLUMNS = [
  { key: 'plurality_k2', label: 'Plurality top-2 (baseline)', shortLabel: 'PT2', optional: false },
  { key: 'approval-mean_k2', label: 'Approval top-2', shortLabel: 'AT2', optional: false },
  { key: 'plurality_k3', label: 'Plurality top-3', shortLabel: 'PT3', optional: false },
  { key: 'approval-mean_k3', label: 'Approval top-3', shortLabel: 'AT3', optional: true },
];

// Local UI state for the optional column + delta-comparison pickers. Kept at
// module scope so it survives across re-renders triggered by new sweep runs
// (state/rule/k/parameter changes), not just across control interactions.
const uiState = {
  showApprovalTop3: false,
  deltaLeftKey: 'plurality_k3',
  deltaRightKey: 'approval-mean_k2',
};

function activeColumns() {
  return COLUMNS.filter((c) => !c.optional || uiState.showApprovalTop3);
}

function buildColumnSelect(columns, selectedKey, onChange) {
  const select = document.createElement('select');
  columns.forEach((c) => select.appendChild(new Option(c.shortLabel, c.key)));
  select.value = selectedKey;
  select.addEventListener('change', (e) => onChange(e.target.value));
  return select;
}

// headlineResults: output of runSweep/runFullSweep, keyed "rule_kK". The full
// sweep already covers every {rule,k} combo, so approval-mean_k3 is present
// whether or not the "Approval top-3" column is currently shown.
export function renderHeadlineTable(container, headlineResults) {
  function draw() {
    container.innerHTML = '';
    container.appendChild(buildControls());
    container.appendChild(buildTable());
  }

  function buildControls() {
    const bar = document.createElement('div');
    bar.className = 'headline-controls';

    const at3Label = document.createElement('label');
    at3Label.className = 'headline-control';
    const at3Checkbox = document.createElement('input');
    at3Checkbox.type = 'checkbox';
    at3Checkbox.checked = uiState.showApprovalTop3;
    at3Checkbox.addEventListener('change', () => {
      uiState.showApprovalTop3 = at3Checkbox.checked;
      const stillActive = new Set(activeColumns().map((c) => c.key));
      if (!stillActive.has(uiState.deltaLeftKey)) uiState.deltaLeftKey = 'plurality_k3';
      if (!stillActive.has(uiState.deltaRightKey)) uiState.deltaRightKey = 'approval-mean_k2';
      draw();
    });
    at3Label.appendChild(at3Checkbox);
    at3Label.appendChild(document.createTextNode(' Show Approval top-3'));
    bar.appendChild(at3Label);

    const cols = activeColumns();
    const deltaGroup = document.createElement('label');
    deltaGroup.className = 'headline-control';
    deltaGroup.appendChild(document.createTextNode('Δ column: '));
    const leftSelect = buildColumnSelect(cols, uiState.deltaLeftKey, (key) => {
      uiState.deltaLeftKey = key;
      draw();
    });
    const rightSelect = buildColumnSelect(cols, uiState.deltaRightKey, (key) => {
      uiState.deltaRightKey = key;
      draw();
    });
    deltaGroup.appendChild(leftSelect);
    deltaGroup.appendChild(document.createTextNode(' − '));
    deltaGroup.appendChild(rightSelect);
    bar.appendChild(deltaGroup);

    return bar;
  }

  function buildTable() {
    const cols = activeColumns();
    const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    const deltaLeft = colByKey[uiState.deltaLeftKey] ? uiState.deltaLeftKey : cols[0].key;
    const deltaRight = colByKey[uiState.deltaRightKey] ? uiState.deltaRightKey : cols[0].key;

    const table = document.createElement('table');
    table.className = 'headline-table';

    const thead = table.createTHead();
    const headRow = thead.insertRow();
    headRow.insertCell().textContent = 'Metric';
    cols.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c.label;
      headRow.appendChild(th);
    });
    const deltaHeadCell = document.createElement('th');
    const leftShort = colByKey[deltaLeft].shortLabel;
    const rightShort = colByKey[deltaRight].shortLabel;
    deltaHeadCell.textContent = `Δ ${leftShort}-${rightShort}`;
    headRow.appendChild(deltaHeadCell);

    const baselineKey = cols[0].key;
    const tbody = table.createTBody();

    METRICS.forEach((meta) => {
      const row = tbody.insertRow();
      const labelCell = row.insertCell();
      labelCell.textContent = meta.label;
      labelCell.className = 'metric-label';

      const rawValues = [];
      const cells = [];

      cols.forEach((c, idx) => {
        const result = headlineResults[c.key];
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
        const title = meta.higherIsBetter ? 'Highest value among the shown methods' : 'Lowest (best) value among the shown methods';
        cells[bestIdx].innerHTML += ` <span class="best-check" title="${title}">✅</span>`;
      }

      const leftValue = headlineResults[deltaLeft] ? headlineResults[deltaLeft][meta.key] : null;
      const rightValue = headlineResults[deltaRight] ? headlineResults[deltaRight][meta.key] : null;
      const deltaCell = row.insertCell();
      const compDelta =
        meta.key === 'vse' && (leftValue == null || rightValue == null) ? '—' : formatDelta(leftValue, rightValue);
      deltaCell.className = 'delta-cell';
      deltaCell.textContent = compDelta;
    });

    return table;
  }

  draw();
}
