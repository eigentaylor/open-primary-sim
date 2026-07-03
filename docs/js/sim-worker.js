// Web Worker entry point: runs sweeps off the main thread so the UI stays
// responsive. Module worker (loaded with {type:'module'}), imports the
// shared simulation modules directly -- no bundler, no importScripts.
// `kind` distinguishes the full {rule,k}-at-one-M sweep from the fixed-
// {rule,k}-across-many-M sweep so ui.js can route each response to the
// right chart section; both echo `kind` back so a single onmessage handler
// on the main thread can tell them apart.

import { runSweep, runMSweep } from './sweep.js';

self.onmessage = (event) => {
  const { requestId, kind } = event.data;

  try {
    if (kind === 'mSweep') {
      const { stateParams, config, seed } = event.data;
      const results = runMSweep(stateParams, config, seed, (progress) => {
        self.postMessage({ type: 'progress', kind, requestId, ...progress });
      });
      self.postMessage({ type: 'done', kind, requestId, results });
    } else {
      const { stateParams, rulesAndKs, config, seed } = event.data;
      const results = runSweep(stateParams, rulesAndKs, config, seed, (progress) => {
        self.postMessage({ type: 'progress', kind: 'full', requestId, ...progress });
      });
      self.postMessage({ type: 'done', kind: 'full', requestId, results });
    }
  } catch (err) {
    self.postMessage({ type: 'error', kind, requestId, message: String(err && err.message ? err.message : err) });
  }
};
