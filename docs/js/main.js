// App bootstrap: init the UI, and optionally load the debug self-test suite
// behind a ?debug=1 URL flag (never loaded/run otherwise).

import { initUI } from './ui.js';

initUI().catch((err) => {
  const status = document.getElementById('sweep-status');
  if (status) {
    status.textContent = `Failed to initialize: ${err.message}`;
    status.classList.add('error');
  }
  console.error(err);
});

if (new URLSearchParams(window.location.search).get('debug') === '1') {
  import('./selftest.js').catch((err) => console.error('selftest failed to load', err));
}
