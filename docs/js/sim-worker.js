// Web Worker entry point: runs a full sweep off the main thread so the UI
// stays responsive. Module worker (loaded with {type:'module'}), imports
// the shared simulation modules directly -- no bundler, no importScripts.

import { runSweep } from './sweep.js';

self.onmessage = (event) => {
  const { requestId, stateParams, rulesAndKs, config, seed } = event.data;

  try {
    const results = runSweep(stateParams, rulesAndKs, config, seed, (progress) => {
      self.postMessage({ type: 'progress', requestId, ...progress });
    });
    self.postMessage({ type: 'done', requestId, results });
  } catch (err) {
    self.postMessage({ type: 'error', requestId, message: String(err && err.message ? err.message : err) });
  }
};
