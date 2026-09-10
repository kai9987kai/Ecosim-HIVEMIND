import { runExperiment } from './experiments.js';

let activeJob = null;

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  const { type, id } = message;
  if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) return;

  if (type === 'cancel') {
    if (activeJob?.id === id) activeJob.cancelled = true;
    return;
  }
  if (type !== 'run') return;
  if (activeJob) {
    self.postMessage({ type: 'error', id, message: 'An experiment is already running. Cancel it before starting another.', cancelled: false });
    return;
  }

  const job = { id, cancelled: false };
  activeJob = job;
  const options = message.options;
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    activeJob = null;
    self.postMessage({ type: 'error', id, message: 'Experiment options must be an object.', cancelled: false });
    return;
  }
  runExperiment({
    ...options,
    onProgress: (progress) => self.postMessage({ type: 'progress', id, progress }),
    shouldCancel: () => job.cancelled,
  }).then((result) => {
    self.postMessage({ type: 'result', id, result });
  }).catch((error) => {
    self.postMessage({ type: 'error', id, message: error.message || 'Experiment failed.', cancelled: error.name === 'AbortError' });
  }).finally(() => {
    if (activeJob === job) activeJob = null;
  });
});
