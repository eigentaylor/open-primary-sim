// DOM wiring: state/rule/k/parameter controls, drives the sim worker for
// full sweeps, and feeds the chart modules. Owns the app's mutable UI state.

import { loadStatesData, buildStateOptions } from './data-loader.js';
import { DEFAULT_CONFIG, fullRulesAndKs, runIllustrativeDraw, RULES, OPTIONAL_RULES, K_VALUES } from './sweep.js';
import { renderDensityChart } from './charts/density-chart.js';
import { renderDrawIllustration } from './charts/draw-illustration.js';
import { renderMetricVsKChart, renderSharedLegend } from './charts/metric-vs-k-chart.js';
import { renderMetricVsMChart, renderSharedLegend as renderMSharedLegend, M_SERIES } from './charts/metric-vs-m-chart.js';
import { renderHeadlineTable } from './charts/headline-table.js';
import { METRICS } from './metrics-meta.js';

const state = {
  data: null,
  stateCode: null,
  config: { ...DEFAULT_CONFIG },
  seed: 42,
  rule: 'plurality',
  k: 2,
  drawIndex: 0,
  worker: null,
  requestId: 0,
  sweepResults: null,
  mSweepResults: null,
  usePav: false,
  showAt3MSweep: true,
  pendingKinds: new Set(),
};

function activeRules() {
  return state.usePav ? [...RULES, ...OPTIONAL_RULES] : RULES;
}

function activeMSeriesKeys() {
  return M_SERIES.filter((s) => !s.optional || state.showAt3MSweep).map((s) => s.key);
}

const el = (id) => document.getElementById(id);

export async function initUI() {
  state.data = await loadStatesData();
  state.stateCode = state.data.default;

  buildStateSelect();
  buildRuleKControls();
  syncParamLabels();
  wireControls();
  wireModal();

  state.worker = new Worker('./js/sim-worker.js', { type: 'module' });
  state.worker.onmessage = handleWorkerMessage;
  state.worker.onerror = (e) => setStatus(`Worker error: ${e.message}`, true);

  runAll();
}

function currentStateParams() {
  return state.data.states[state.stateCode];
}

// ---- Build static controls ----------------------------------------------

function buildStateSelect() {
  const select = el('state-select');
  select.innerHTML = '';
  const { pinned, rest } = buildStateOptions(state.data);

  const pinnedGroup = document.createElement('optgroup');
  pinnedGroup.label = 'Pinned';
  pinned.forEach(({ code, name }) => pinnedGroup.appendChild(new Option(`${name} (${code})`, code)));
  select.appendChild(pinnedGroup);

  const restGroup = document.createElement('optgroup');
  restGroup.label = 'All states';
  rest.forEach(({ code, name }) => restGroup.appendChild(new Option(`${name} (${code})`, code)));
  select.appendChild(restGroup);

  select.value = state.stateCode;
}

function buildRuleKControls() {
  const ruleSelect = el('rule-select');
  ruleSelect.innerHTML = '';
  const ruleLabels = {
    plurality: 'Plurality',
    'approval-mean': 'Approval (mean threshold)',
    'approval-tau': 'Approval (fixed τ)',
    pav: 'PAV (proportional approval)',
  };
  // The illustrative draw is a single iteration (cheap even for PAV's
  // brute-force committee search), so it always offers every rule --
  // independent of the "Use PAV" toggle, which only gates the expensive
  // nSim-repeated full sweep below.
  [...RULES, ...OPTIONAL_RULES].forEach((r) => ruleSelect.appendChild(new Option(ruleLabels[r], r)));
  ruleSelect.value = state.rule;

  const kSelect = el('k-select');
  kSelect.innerHTML = '';
  K_VALUES.forEach((k) => kSelect.appendChild(new Option(`top-${k}`, k)));
  kSelect.value = state.k;
}

function syncParamLabels() {
  el('m-slider').value = state.config.M;
  el('m-value').textContent = String(state.config.M);
  el('delta-slider').value = state.config.delta;
  el('delta-value').textContent = state.config.delta.toFixed(2);
  el('gamma-slider').value = state.config.gamma;
  el('gamma-value').textContent = state.config.gamma.toFixed(2);
  el('tau-slider').value = state.config.tau;
  el('tau-value').textContent = state.config.tau.toFixed(2);
  el('nsim-slider').value = state.config.nSim;
  el('nsim-value').textContent = String(state.config.nSim);
  el('use-pav-checkbox').checked = state.usePav;
  el('show-at3-msweep-checkbox').checked = state.showAt3MSweep;
}

// ---- Event wiring ---------------------------------------------------------

function wireControls() {
  el('state-select').addEventListener('change', (e) => {
    state.stateCode = e.target.value;
    runAll();
  });

  el('rule-select').addEventListener('change', (e) => {
    state.rule = e.target.value;
    renderIllustrative();
  });
  el('k-select').addEventListener('change', (e) => {
    state.k = Number(e.target.value);
    renderIllustrative();
  });
  el('redraw-btn').addEventListener('click', () => {
    state.drawIndex += 1;
    renderIllustrative();
  });
  el('reroll-seed-btn').addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 2 ** 31);
    state.drawIndex = 0;
    runAll();
  });

  el('m-slider').addEventListener('input', (e) => {
    el('m-value').textContent = e.target.value;
  });
  el('m-slider').addEventListener('change', (e) => {
    state.config.M = Number(e.target.value);
    runAll();
  });

  el('delta-slider').addEventListener('input', (e) => {
    el('delta-value').textContent = Number(e.target.value).toFixed(2);
  });
  el('delta-slider').addEventListener('change', (e) => {
    state.config.delta = Number(e.target.value);
    runAll();
  });

  el('gamma-slider').addEventListener('input', (e) => {
    el('gamma-value').textContent = Number(e.target.value).toFixed(2);
  });
  el('gamma-slider').addEventListener('change', (e) => {
    state.config.gamma = Number(e.target.value);
    runAll();
  });

  el('tau-slider').addEventListener('input', (e) => {
    el('tau-value').textContent = Number(e.target.value).toFixed(2);
  });
  el('tau-slider').addEventListener('change', (e) => {
    state.config.tau = Number(e.target.value);
    runAll();
  });

  el('nsim-slider').addEventListener('input', (e) => {
    el('nsim-value').textContent = e.target.value;
  });
  el('nsim-slider').addEventListener('change', (e) => {
    state.config.nSim = Number(e.target.value);
    runAll();
  });

  el('use-pav-checkbox').addEventListener('change', (e) => {
    state.usePav = e.target.checked;
    runAll();
  });

  // Display-only toggle -- the M-sweep always computes all 3 series, so this
  // just re-renders from the already-computed results, no new sweep needed.
  el('show-at3-msweep-checkbox').addEventListener('change', (e) => {
    state.showAt3MSweep = e.target.checked;
    renderMSweepCharts();
  });
}

// ---- Rendering -------------------------------------------------------------

function renderIllustrative() {
  const stateParams = currentStateParams();
  const { ctx, detail } = runIllustrativeDraw(stateParams, state.config, state.seed, state.rule, state.k, state.drawIndex);
  renderDrawIllustration(el('draw-illustration'), detail, ctx, stateParams);
}

function renderMetricCharts(sweepResults) {
  const grid = el('metrics-grid');
  grid.innerHTML = '';
  const rules = activeRules();
  METRICS.forEach((meta) => {
    const cell = document.createElement('div');
    cell.className = 'metric-chart-cell';
    cell.title = 'Click to enlarge';
    grid.appendChild(cell);
    renderMetricVsKChart(cell, meta, sweepResults, rules, { mValue: state.config.M });
    cell.addEventListener('click', () => openMetricModal(meta));
  });
  el('metrics-legend').innerHTML = '';
  renderSharedLegend(el('metrics-legend'), rules);
}

function openMetricModal(meta) {
  const body = el('chart-modal-body');
  body.innerHTML = '';
  el('chart-modal-overlay').hidden = false; // must be visible before rendering so SVG getBBox() legend layout works
  renderMetricVsKChart(body, meta, state.sweepResults, activeRules(), { height: 420, mValue: state.config.M });
}

function renderMSweepCharts() {
  const grid = el('m-metrics-grid');
  grid.innerHTML = '';
  if (!state.mSweepResults) return;
  const seriesKeys = activeMSeriesKeys();
  METRICS.forEach((meta) => {
    const cell = document.createElement('div');
    cell.className = 'metric-chart-cell';
    cell.title = 'Click to enlarge';
    grid.appendChild(cell);
    renderMetricVsMChart(cell, meta, state.mSweepResults, seriesKeys);
    cell.addEventListener('click', () => openMSweepMetricModal(meta));
  });
  el('m-metrics-legend').innerHTML = '';
  renderMSharedLegend(el('m-metrics-legend'), seriesKeys);
}

function openMSweepMetricModal(meta) {
  const body = el('chart-modal-body');
  body.innerHTML = '';
  el('chart-modal-overlay').hidden = false; // must be visible before rendering so SVG getBBox() legend layout works
  renderMetricVsMChart(body, meta, state.mSweepResults, activeMSeriesKeys(), { height: 420 });
}

function closeMetricModal() {
  el('chart-modal-overlay').hidden = true;
  el('chart-modal-body').innerHTML = '';
}

function wireModal() {
  el('chart-modal-close').addEventListener('click', closeMetricModal);
  el('chart-modal-overlay').addEventListener('click', (e) => {
    if (e.target === el('chart-modal-overlay')) closeMetricModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('chart-modal-overlay').hidden) closeMetricModal();
  });
}

function setStatus(text, isError = false) {
  const s = el('sweep-status');
  s.textContent = text;
  s.classList.toggle('error', isError);
}

// ---- Sweep orchestration (Web Worker) ---------------------------------------

function runAll() {
  const stateParams = currentStateParams();
  renderDensityChart(el('density-chart'), stateParams);
  renderIllustrative();

  state.requestId += 1;
  const requestId = state.requestId;
  // Both requests share this run's requestId, so a superseded runAll() call
  // drops stale responses from either one; the worker processes them FIFO
  // (one message queue), so the M-sweep's status text follows the full
  // sweep's rather than interleaving with it.
  state.pendingKinds = new Set(['full', 'mSweep']);
  setStatus(`Running sweep for ${stateParams.name}…`);

  state.worker.postMessage({
    kind: 'full',
    requestId,
    stateParams,
    rulesAndKs: fullRulesAndKs(state.usePav ? OPTIONAL_RULES : []),
    config: state.config,
    seed: state.seed,
  });

  state.worker.postMessage({
    kind: 'mSweep',
    requestId,
    stateParams,
    config: state.config,
    seed: state.seed,
  });
}

function handleWorkerMessage(event) {
  const { type, requestId, kind } = event.data;
  if (requestId !== state.requestId) return; // stale response from a superseded request

  if (type === 'progress') {
    const label = kind === 'mSweep' ? 'M-sweep' : 'sweep';
    setStatus(`Running ${label}… (${event.data.done}/${event.data.total})`);
  } else if (type === 'done') {
    if (kind === 'mSweep') {
      state.mSweepResults = event.data.results;
      renderMSweepCharts();
    } else {
      state.sweepResults = event.data.results;
      renderHeadlineTable(el('headline-table'), state.sweepResults);
      renderMetricCharts(state.sweepResults);
    }
    state.pendingKinds.delete(kind);
    if (state.pendingKinds.size === 0) setStatus('');
  } else if (type === 'error') {
    setStatus(`Simulation error: ${event.data.message}`, true);
  }
}
