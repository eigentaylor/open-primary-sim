// DOM wiring: state/rule/k/parameter controls, drives the sim worker for
// full sweeps, and feeds the chart modules. Owns the app's mutable UI state.

import { loadStatesData, buildStateOptions } from './data-loader.js';
import { DEFAULT_CONFIG, fullRulesAndKs, runIllustrativeDraw, RULES, OPTIONAL_RULES, DYNAMIC_RULES, K_VALUES } from './sweep.js';
import { runDynamicIllustrativeDraw } from './dynamic-process.js';
import { renderDensityChart } from './charts/density-chart.js';
import { renderDrawMetrics } from './charts/draw-illustration.js';
import { renderElectionResults } from './charts/election-results.js';
import { renderVoteShareHistogram } from './charts/vote-share-histogram.js';
import { renderMetricVsTChart } from './charts/metric-vs-t-chart.js';
import { renderMetricVsKChart, renderSharedLegend } from './charts/metric-vs-k-chart.js';
import { renderMetricVsMChart, renderSharedLegend as renderMSharedLegend, M_SERIES } from './charts/metric-vs-m-chart.js';
import { renderHeadlineTable } from './charts/headline-table.js';
import { METRICS } from './metrics-meta.js';

// Rule dropdown labels, shared between the full-list build (static mode) and
// the restricted plurality/approval-mean-only rebuild (dynamic mode) --
// dynamic abandonment only has a well-defined ballot for those two rules
// (approval-tau's fixed threshold and PAV's committee scoring don't have a
// natural per-candidate-rank "abandon toward viability" analog).
const RULE_LABELS = {
  plurality: 'Plurality',
  'approval-mean': 'Approval (mean threshold)',
  'approval-tau': 'Approval (fixed τ)',
  pav: 'PAV (proportional approval)',
};
const DYNAMIC_MODE_RULES = ['plurality', 'approval-mean'];

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
  resultsView: 'primary',
  detail: null,
  drawCtx: null,
  pendingKinds: new Set(),
  dynamicMode: false,
  t: 0,
  dynamicResult: null, // { ctx, steps, equilibrium, letterMap } when dynamicMode is on, else null
  letterMap: null, // mirrors dynamicResult.letterMap; null in static mode
  useDynamicSweep: false, // separate from dynamicMode -- gates dynamic-process variants in the k-sweep/headline table, not the illustrative draw
};

// lambda/eta live in state.config (see DEFAULT_CONFIG in sweep.js) rather
// than as separate top-level state fields, since they're now shared between
// the illustrative draw AND the dynamic-sweep variants below.

function activeRules() {
  return [...RULES, ...(state.usePav ? OPTIONAL_RULES : []), ...(state.useDynamicSweep ? DYNAMIC_RULES : [])];
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
  rebuildRuleSelect();

  const kSelect = el('k-select');
  kSelect.innerHTML = '';
  K_VALUES.forEach((k) => kSelect.appendChild(new Option(`top-${k}`, k)));
  kSelect.value = state.k;
}

// The illustrative draw is a single iteration (cheap even for PAV's
// brute-force committee search), so in STATIC mode it always offers every
// rule -- independent of the "Use PAV" toggle, which only gates the
// expensive nSim-repeated full sweep below. In DYNAMIC mode, only plurality
// and approval-mean have a well-defined abandonment ballot, so the dropdown
// is restricted to those two -- if the previously-active rule isn't among
// them, snap to plurality.
function rebuildRuleSelect() {
  const ruleSelect = el('rule-select');
  const allowed = state.dynamicMode ? DYNAMIC_MODE_RULES : [...RULES, ...OPTIONAL_RULES];
  ruleSelect.innerHTML = '';
  allowed.forEach((r) => ruleSelect.appendChild(new Option(RULE_LABELS[r], r)));
  if (!allowed.includes(state.rule)) state.rule = 'plurality';
  ruleSelect.value = state.rule;
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
  el('dynamic-mode-checkbox').checked = state.dynamicMode;
  el('lambda-slider').value = state.config.lambda;
  el('lambda-value').textContent = state.config.lambda.toFixed(2);
  el('eta-slider').value = state.config.eta;
  el('eta-value').textContent = state.config.eta.toFixed(3);
  el('alpha-slider').value = state.config.alpha;
  el('alpha-value').textContent = state.config.alpha.toFixed(1);
  el('dynamic-sweep-checkbox').checked = state.useDynamicSweep;
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

  el('dynamic-mode-checkbox').addEventListener('change', (e) => {
    state.dynamicMode = e.target.checked;
    rebuildRuleSelect();
    runAll();
  });

  el('lambda-slider').addEventListener('input', (e) => {
    el('lambda-value').textContent = Number(e.target.value).toFixed(2);
  });
  el('lambda-slider').addEventListener('change', (e) => {
    state.config.lambda = Number(e.target.value);
    runAll();
  });

  el('eta-slider').addEventListener('input', (e) => {
    el('eta-value').textContent = Number(e.target.value).toFixed(3);
  });
  el('eta-slider').addEventListener('change', (e) => {
    state.config.eta = Number(e.target.value);
    runAll();
  });

  el('alpha-slider').addEventListener('input', (e) => {
    el('alpha-value').textContent = Number(e.target.value).toFixed(1);
  });
  el('alpha-slider').addEventListener('change', (e) => {
    state.config.alpha = Number(e.target.value);
    runAll();
  });

  el('dynamic-sweep-checkbox').addEventListener('change', (e) => {
    state.useDynamicSweep = e.target.checked;
    runAll();
  });

  // Scrubbing t is a pure array-index operation over already-computed
  // per-round snapshots -- no 'change'-triggered recompute needed, 'input'
  // alone re-renders instantly.
  el('t-slider').addEventListener('input', (e) => {
    state.t = Number(e.target.value);
    el('t-value').textContent = String(state.t);
    renderIllustrativeFromStep();
  });

  // Display-only toggle -- the M-sweep always computes all 3 series, so this
  // just re-renders from the already-computed results, no new sweep needed.
  el('show-at3-msweep-checkbox').addEventListener('change', (e) => {
    state.showAt3MSweep = e.target.checked;
    renderMSweepCharts();
  });

  // Display-only toggle -- the current draw's detail already has both
  // rankings computed, so this just re-renders the results table.
  el('results-view-primary-btn').addEventListener('click', () => setResultsView('primary'));
  el('results-view-general-btn').addEventListener('click', () => setResultsView('general'));
  el('results-view-histogram-btn').addEventListener('click', () => setResultsView('histogram'));
}

function setResultsView(view) {
  state.resultsView = view;
  el('results-view-primary-btn').classList.toggle('active', view === 'primary');
  el('results-view-general-btn').classList.toggle('active', view === 'general');
  el('results-view-histogram-btn').classList.toggle('active', view === 'histogram');
  renderResultsPanel();
}

function renderResultsPanel() {
  if (!state.detail) return;
  if (state.resultsView === 'histogram') {
    renderVoteShareHistogram(el('election-results'), state.detail, state.drawCtx, state.letterMap);
  } else {
    renderElectionResults(el('election-results'), state.detail, state.drawCtx, state.resultsView, state.rule, state.letterMap);
  }
}

// ---- Rendering -------------------------------------------------------------

function renderIllustrative() {
  const stateParams = currentStateParams();

  if (state.dynamicMode) {
    const result = runDynamicIllustrativeDraw(stateParams, state.config, state.seed, state.rule, state.k, state.drawIndex, {
      lambda: state.config.lambda,
      eta: state.config.eta,
      alpha: state.config.alpha,
    });
    state.dynamicResult = result;
    state.drawCtx = result.ctx;
    state.letterMap = result.letterMap;
    state.t = result.steps.length - 1; // default to the final round on a fresh run
    el('t-slider').max = String(result.steps.length - 1);
    el('t-slider').value = String(state.t);
    el('t-value').textContent = String(state.t);
    // The equilibrium classifier's nontrivial-share threshold doesn't map
    // cleanly onto approval-mean's ballot structure (approval tallies can
    // sum >100%, so "share of total weight" isn't the same kind of
    // quantity) -- hide the badge there until the classifier is revisited,
    // rather than show a label that isn't meaningful yet.
    renderEquilibriumBadge(state.rule === 'approval-mean' ? null : result.equilibrium);
    renderMetricsVsTCharts(result.steps);
  } else {
    const { ctx, detail } = runIllustrativeDraw(stateParams, state.config, state.seed, state.rule, state.k, state.drawIndex);
    state.detail = detail;
    state.drawCtx = ctx;
    state.dynamicResult = null;
    state.letterMap = null;
    renderEquilibriumBadge(null);
  }

  el('dynamic-step-panel').hidden = !state.dynamicMode;
  el('t-metrics-section').hidden = !state.dynamicMode;
  document.body.classList.toggle('has-dynamic-footer', state.dynamicMode);
  renderIllustrativeFromStep();
}

// Re-renders the density chart / draw-metrics / election-results from
// whichever detail is current -- state.dynamicResult.steps[state.t] in
// dynamic mode, or the static detail already assigned in renderIllustrative()
// otherwise. Reused by both the initial render and the t-slider's scrub
// handler (a pure array-index operation, no recomputation).
function renderIllustrativeFromStep() {
  const stateParams = currentStateParams();
  if (state.dynamicMode) {
    state.detail = state.dynamicResult.steps[state.t];
  }
  renderDensityChart(el('density-chart'), stateParams, state.detail, state.drawCtx);
  renderDrawMetrics(el('draw-illustration'), state.detail, state.drawCtx);
  renderResultsPanel();
}

function renderEquilibriumBadge(equilibrium) {
  const node = el('equilibrium-badge');
  if (!equilibrium) {
    node.textContent = '';
    node.className = 'equilibrium-badge';
    return;
  }
  const label =
    equilibrium.type === 'trivial'
      ? 'N/A (M ≤ k, no elimination threshold)'
      : equilibrium.type === 'duvergerian'
        ? 'Duvergerian equilibrium'
        : 'Non-Duvergerian (plateau)';
  const note =
    equilibrium.type === 'trivial' ? '' : equilibrium.converged ? ' — converged' : ' — hit iteration cap without converging';
  node.textContent = `${label}${note} (t=${equilibrium.finalT})`;
  node.className = `equilibrium-badge ${equilibrium.type}`;
}

function renderMetricsVsTCharts(steps) {
  const grid = el('t-metrics-grid');
  grid.innerHTML = '';
  METRICS.forEach((meta) => {
    const cell = document.createElement('div');
    cell.className = 'metric-chart-cell';
    cell.title = 'Click to enlarge';
    grid.appendChild(cell);
    renderMetricVsTChart(cell, meta, steps);
    cell.addEventListener('click', () => openTMetricModal(meta));
  });
}

function openTMetricModal(meta) {
  const body = el('chart-modal-body');
  body.innerHTML = '';
  el('chart-modal-overlay').hidden = false; // must be visible before rendering so SVG getBBox() legend layout works
  renderMetricVsTChart(body, meta, state.dynamicResult.steps, { height: 420 });
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
    rulesAndKs: fullRulesAndKs([
      ...(state.usePav ? OPTIONAL_RULES : []),
      ...(state.useDynamicSweep ? DYNAMIC_RULES : []),
    ]),
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
