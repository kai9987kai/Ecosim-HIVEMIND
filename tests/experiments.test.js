import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { runExperiment, EXPERIMENT_LIMITS } from '../src/experiments.js';
import { Simulation, MODEL_VERSION } from '../src/simulation.js';

function withoutTimestamp(result) {
  const { createdAt, ...stable } = result;
  assert.equal(Number.isNaN(Date.parse(createdAt)), false);
  return stable;
}

test('paired seeds run identical settings except cooperation and preserve raw endpoints', async () => {
  const config = Object.freeze({
    seed: 'paired-test', preset: 'wetlands', cooperation: 0.65,
    mutationRate: 0.04, resourceRate: 1.2, seasonality: 0.2,
  });
  const seeds = Object.freeze(['replicate-seven', 'replicate-max']);
  const result = await runExperiment({ config, seeds, ticks: 31 });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.modelVersion, MODEL_VERSION);
  assert.deepEqual(result.config, config);
  assert.deepEqual(result.seeds, seeds);
  assert.equal(result.rows.length, seeds.length);
  for (const row of result.rows) {
    const baseline = new Simulation({ ...config, seed: row.seed, cooperation: 0 }).step(31).metrics();
    const shared = new Simulation({ ...config, seed: row.seed }).step(31).metrics();
    assert.deepEqual(row.baseline, baseline);
    assert.deepEqual(row.shared, shared);
    for (const key of Object.keys(row.delta)) assert.equal(row.delta[key], shared[key] - baseline[key]);
  }
  for (const [key, summary] of Object.entries(result.summary)) {
    const [first, second] = result.rows;
    assert.equal(summary.baselineMean, (first.baseline[key] + second.baseline[key]) / 2);
    assert.equal(summary.sharedMean, (first.shared[key] + second.shared[key]) / 2);
    assert.equal(summary.meanDelta, (first.delta[key] + second.delta[key]) / 2);
    assert.ok(Math.abs(summary.standardError - Math.abs(first.delta[key] - second.delta[key]) / 2) < 1e-10);
  }
  assert.match(result.conclusion, /descriptive/);
  assert.match(result.conclusion, /not proof of benefit/);
});

test('the same protocol produces repeatable rows, seeds, and summaries', async () => {
  const options = { config: { seed: 'repeatable-928', preset: 'dunes' }, replicates: 3, ticks: 51 };
  const first = withoutTimestamp(await runExperiment(options));
  const second = withoutTimestamp(await runExperiment(options));
  assert.deepEqual(first, second);
  assert.equal(new Set(first.seeds).size, 3);
  assert.equal(first.seeds[0], options.config.seed);
});

test('zero cooperation produces exactly equal paired arms', async () => {
  const result = await runExperiment({ config: { cooperation: 0 }, seeds: ['9', '21'], ticks: 76 });
  for (const row of result.rows) {
    assert.deepEqual(row.baseline, row.shared);
    for (const value of Object.values(row.delta)) assert.equal(value, 0);
  }
});

test('one replicate reports unavailable standard error instead of invented certainty', async () => {
  const result = await runExperiment({ seeds: ['0'], ticks: 1 });
  for (const summary of Object.values(result.summary)) assert.equal(summary.standardError, null);
  assert.match(result.conclusion, /unavailable with one pair/);
});

test('progress is ordered, bounded, and finishes after all pairs are recorded', async () => {
  const updates = [];
  const result = await runExperiment({ seeds: ['1', '2'], ticks: 51, onProgress: (value) => updates.push(value) });
  assert.equal(updates[0].fraction, 0);
  assert.equal(updates[0].completed, 0);
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    assert.equal(update.total, result.rows.length);
    assert.ok(update.fraction >= 0 && update.fraction <= 1);
    assert.ok(update.tick >= 0 && update.tick <= 51);
    if (index) assert.ok(update.fraction >= updates[index - 1].fraction);
  }
  assert.equal(updates.at(-1).phase, 'complete');
  assert.equal(updates.at(-1).fraction, 1);
  assert.equal(updates.at(-1).completed, 2);
});

test('cancellation before a run or between chunks rejects with AbortError', async () => {
  await assert.rejects(runExperiment({ shouldCancel: () => true }), { name: 'AbortError' });
  let cancelled = false;
  let updates = 0;
  await assert.rejects(runExperiment({
    seeds: ['12'], ticks: 100,
    onProgress: (progress) => {
      updates += 1;
      if (progress.tick > 0) setTimeout(() => { cancelled = true; }, 0);
    },
    shouldCancel: () => cancelled,
  }), { name: 'AbortError' });
  assert.equal(updates, 2, 'event-loop cancellation stops before another chunk');
});

test('invalid or excessive experiment jobs are rejected', async () => {
  const invalid = [
    null, [], { ticks: 0 }, { ticks: -1 }, { ticks: 1.5 }, { ticks: NaN },
    { ticks: Infinity }, { ticks: '10' }, { ticks: EXPERIMENT_LIMITS.ticks + 1 },
    { replicates: 0 }, { replicates: 2.5 }, { replicates: EXPERIMENT_LIMITS.replicates + 1 },
    { seeds: [] }, { seeds: ['same', 'same'] }, { seeds: [NaN] }, { seeds: [-1] },
    { seeds: [0x100000000] }, { seeds: [1.25] }, { seeds: '4' }, { seeds: Array(1) },
    { seeds: Array.from({ length: 13 }, (_, index) => String(index)) },
    { seeds: [''] }, { seeds: ['   '] }, { seeds: ['x'.repeat(129)] },
    { config: null }, { config: [] }, { config: { preset: 'ocean' } },
    { config: { seed: -1 } }, { config: { seed: 3.5 } }, { config: { seed: '' } },
    { config: { cooperation: NaN } }, { config: { cooperation: 1.01 } },
    { config: { cooperation: '0.5' } }, { config: { mutationRate: 0.51 } },
    { config: { resourceRate: -0.01 } }, { config: { seasonality: -0.1 } },
    { config: { unknown: true } }, { shouldCancel: false }, { onProgress: 'progress' },
  ];
  for (const options of invalid) await assert.rejects(runExperiment(options));
});

test('worker rejects overlapping runs, cancels, and accepts the next job', { timeout: 15000 }, async (context) => {
  const workerUrl = new URL('../src/experiment-worker.js', import.meta.url).href;
  const bootstrap = `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = {
      addEventListener: (type, callback) => parentPort.on(type, (data) => callback({ data })),
      postMessage: (value) => parentPort.postMessage(value),
    };
    await import(${JSON.stringify(workerUrl)});
    parentPort.postMessage({ type: 'ready' });
  `;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`));
  context.after(() => worker.terminate());
  const messages = [];
  const pending = [];
  worker.on('message', (message) => {
    messages.push(message);
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const waiter = pending[index];
      if (waiter.matches(message)) {
        pending.splice(index, 1);
        waiter.resolve(message);
      }
    }
  });
  worker.on('error', (error) => {
    for (const waiter of pending.splice(0)) waiter.reject(error);
  });
  const waitFor = (matches) => {
    const found = messages.find(matches);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => pending.push({ matches, resolve, reject }));
  };
  await waitFor((message) => message.type === 'ready');
  worker.postMessage({ type: 'run', id: 'first', options: { replicates: 12, ticks: 3000 } });
  await waitFor((message) => message.id === 'first' && message.type === 'progress');
  worker.postMessage({ type: 'run', id: 'overlap', options: { ticks: 1 } });
  const overlap = await waitFor((message) => message.id === 'overlap' && message.type === 'error');
  assert.equal(overlap.cancelled, false);
  assert.match(overlap.message, /already running/);
  worker.postMessage({ type: 'cancel', id: 'first' });
  const cancelled = await waitFor((message) => message.id === 'first' && message.type === 'error');
  assert.equal(cancelled.cancelled, true);
  assert.equal(messages.some((message) => message.id === 'first' && message.type === 'result'), false);
  worker.postMessage({ type: 'run', id: 'next', options: { seeds: ['8'], ticks: 1 } });
  const completed = await waitFor((message) => message.id === 'next' && message.type === 'result');
  assert.equal(completed.result.rows.length, 1);
  assert.equal(completed.result.ticks, 1);
  worker.postMessage({ type: 'run', id: 'invalid', options: { ticks: Infinity } });
  const invalid = await waitFor((message) => message.id === 'invalid' && message.type === 'error');
  assert.equal(invalid.cancelled, false);
  assert.match(invalid.message, /ticks must be an integer/);
});
