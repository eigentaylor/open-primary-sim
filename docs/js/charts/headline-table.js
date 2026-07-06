// Headline comparison table: Plurality-top2 (baseline) vs. Approval-top2 vs.
// Plurality-top3, all 6 metrics, with %-vs-baseline (or percentage-point
// difference at a ~0 baseline, see metrics-meta.js). PAV-top3 and
// Approval-top3 are optional columns, off by default. The rightmost "Δ"
// column subtracts any two shown columns, chosen via the dropdowns (default
// PT3 − AT2).

import { METRICS, formatDelta } from '../metrics-meta.js';

// Fixed catalog of columns this table knows how to show. `key` matches the
// "rule_kK" keys produced by runSweep/runFullSweep. Order here is display
// order; the first entry is always the baseline and is never hidden. Each
// rule's dynamic-abandonment-process sibling (see dynamic-process.js) sits
// directly adjacent to its static column, rather than grouped at the end,
// so the two are easy to compare side by side. `tooltip` is the disabled-
// checkbox hover text shown when a column is unavailable (see
// buildOptionalToggle below); columns without their own checkbox (the
// non-optional ones) don't need it.
const COLUMNS = [
  { key: 'plurality_k2', label: 'Plurality top-2 (baseline)', shortLabel: 'PT2', optional: false },
  {
    key: 'plurality-dynamic_k2',
    label: 'Plurality top-2 (dynamic)',
    shortLabel: 'PT2-D',
    optional: true,
    uiFlag: 'showDynamicColumns',
    tooltip: 'Enable "Include dynamic-process variants" in the controls panel to compute this column',
  },
  { key: 'approval-mean_k2', label: 'Approval top-2', shortLabel: 'AT2', optional: false },
  {
    key: 'approval-mean-dynamic_k2',
    label: 'Approval top-2 (dynamic)',
    shortLabel: 'AT2-D',
    optional: true,
    uiFlag: 'showDynamicColumns',
    tooltip: 'Enable "Include dynamic-process variants" in the controls panel to compute this column',
  },
  { key: 'plurality_k3', label: 'Plurality top-3', shortLabel: 'PT3', optional: false },
  {
    key: 'plurality-dynamic_k3',
    label: 'Plurality top-3 (dynamic)',
    shortLabel: 'PT3-D',
    optional: true,
    uiFlag: 'showDynamicColumns',
    tooltip: 'Enable "Include dynamic-process variants" in the controls panel to compute this column',
  },
  {
    key: 'pav_k3',
    label: 'PAV top-3',
    shortLabel: 'PAVT3',
    optional: true,
    uiFlag: 'showPavTop3',
    tooltip: 'Enable "Use PAV" in the controls panel to compute this column',
  },
  { key: 'approval-mean_k3', label: 'Approval top-3', shortLabel: 'AT3', optional: true, uiFlag: 'showApprovalTop3', tooltip: null },
  {
    // Reuses the SAME uiFlag as static AT3 (see the user's request: one
    // checkbox toggles both) -- its own visibility still independently
    // depends on isColumnAvailable() below, so checking "Show Approval
    // top-3" alone doesn't show this column until the dynamic-sweep
    // checkbox has ALSO been on for a sweep run.
    key: 'approval-mean-dynamic_k3',
    label: 'Approval top-3 (dynamic)',
    shortLabel: 'AT3-D',
    optional: true,
    uiFlag: 'showApprovalTop3',
    tooltip: 'Enable "Include dynamic-process variants" in the controls panel (in addition to Show Approval top-3) to compute this column',
  },
];

// Local UI state for the optional column + delta-comparison pickers. Kept at
// module scope so it survives across re-renders triggered by new sweep runs
// (state/rule/k/parameter changes), not just across control interactions.
const uiState = {
  showPavTop3: false,
  showApprovalTop3: false,
  showDynamicColumns: false,
  deltaLeftKey: 'plurality_k3',
  deltaRightKey: 'approval-mean_k2',
};

// A column's underlying rule/k may not have been computed at all -- e.g.
// pav_k3 only exists when the "Use PAV" sweep toggle was on, and the four
// "-dynamic" keys only exist when "Include dynamic-process variants" was on
// -- if absent, treat the column as unavailable regardless of checkbox
// state, rather than showing a column of dashes.
function isColumnAvailable(c, headlineResults) {
  return headlineResults[c.key] != null;
}

function activeColumns(headlineResults) {
  return COLUMNS.filter(
    (c) => (!c.optional || uiState[c.uiFlag]) && isColumnAvailable(c, headlineResults)
  );
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

    function buildOptionalToggle(column, text) {
      const available = isColumnAvailable(column, headlineResults);
      const label = document.createElement('label');
      label.className = 'headline-control';
      if (!available && column.tooltip) label.title = column.tooltip;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = uiState[column.uiFlag];
      checkbox.disabled = !available;
      checkbox.addEventListener('change', () => {
        uiState[column.uiFlag] = checkbox.checked;
        const stillActive = new Set(activeColumns(headlineResults).map((c) => c.key));
        if (!stillActive.has(uiState.deltaLeftKey)) uiState.deltaLeftKey = 'plurality_k3';
        if (!stillActive.has(uiState.deltaRightKey)) uiState.deltaRightKey = 'approval-mean_k2';
        draw();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(text));
      return label;
    }
    // Keep the FIRST column per uiFlag (not last) -- AT3-D shares
    // showApprovalTop3 with (and appears after) static AT3, so a last-wins
    // map would make this checkbox's disabled/tooltip state track AT3-D's
    // availability instead of AT3's, incorrectly disabling a checkbox that
    // should always be usable (static AT3 is always computable; only the
    // paired AT3-D depends on the dynamic-sweep toggle).
    const columnByFlag = COLUMNS.reduce((acc, c) => {
      if (c.uiFlag && !(c.uiFlag in acc)) acc[c.uiFlag] = c;
      return acc;
    }, {});
    bar.appendChild(buildOptionalToggle(columnByFlag.showPavTop3, ' Show PAV top-3'));
    bar.appendChild(buildOptionalToggle(columnByFlag.showApprovalTop3, ' Show Approval top-3'));
    bar.appendChild(buildOptionalToggle(columnByFlag.showDynamicColumns, ' Show dynamic-process columns (PT2-D/AT2-D/PT3-D)'));

    const cols = activeColumns(headlineResults);
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
    const cols = activeColumns(headlineResults);
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
      th.textContent = c.shortLabel;
      th.title = c.label;
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
