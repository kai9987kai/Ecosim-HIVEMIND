import { Simulation, MODEL_VERSION, DEFAULT_CONFIG } from './simulation.js';

export const EXPERIMENT_LIMITS = Object.freeze({ replicates: 12, ticks: 3000 });

const METRIC_KEYS = Object.freeze([
  'population', 'foragers', 'predators', 'plants', 'meanEnergy',
  'diversity', 'generation', 'cooperation',
]);
const CHUNK_TICKS = 25;

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function bounded(value, name, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function validSeed(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new TypeError(`${name} must be a nonempty string of at most 128 characters.`);
  }
  return value;
}

function deriveSeeds(seed, count) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return seed;
    const derived = `replicate:${(hash >>> 0).toString(16)}:${index + 1}`;
    return derived === seed ? `pair:${derived}` : derived;
  });
}

function normalizeConfig(config = {}) {
  object(config, 'config');
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new TypeError(`Unknown experiment config setting: ${key}.`);
  }
  const normalized = { ...DEFAULT_CONFIG, ...config };
  validSeed(normalized.seed, 'config.seed');
  if (!['meadow', 'dunes', 'wetlands'].includes(normalized.preset)) {
    throw new RangeError('config.preset must be meadow, dunes, or wetlands.');
  }
  bounded(normalized.cooperation, 'config.cooperation', 0, 1);
  bounded(normalized.mutationRate, 'config.mutationRate', 0, 0.5);
  bounded(normalized.resourceRate, 'config.resourceRate', 0, 3);
  bounded(normalized.seasonality, 'config.seasonality', 0, 1);
  return Object.freeze(normalized);
}

function checkCancellation(shouldCancel) {
  if (shouldCancel?.()) {
    const error = new Error('Experiment cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function checkedMetrics(simulation) {
  const metrics = simulation.metrics();
  for (const key of METRIC_KEYS) {
    if (!Number.isFinite(metrics[key])) {
      throw new Error(`Simulation returned a non-finite ${key} metric.`);
    }
  }
  return { ...metrics };
}

function summarize(rows) {
  const count = rows.length;
  return Object.fromEntries(METRIC_KEYS.map((key) => {
    const baselineMean = rows.reduce((sum, row) => sum + row.baseline[key], 0) / count;
    const sharedMean = rows.reduce((sum, row) => sum + row.shared[key], 0) / count;
    const meanDelta = rows.reduce((sum, row) => sum + row.delta[key], 0) / count;
    const squaredDeviations = rows.reduce((sum, row) => sum + (row.delta[key] - meanDelta) ** 2, 0);
    const standardError = count > 1 ? Math.sqrt(squaredDeviations / (count - 1) / count) : null;
    return [key, { baselineMean, sharedMean, meanDelta, standardError }];
  }));
}

/**
 * Compare independent and shared-information agents with paired initial seeds.
 * Explicit seeds determine replicate count; replicates is used when seeds is absent.
 * The result is descriptive output from this model, not ecological validation.
 * Progress: {completed,total,fraction,replicate,seed,tick,ticks,phase}.
 * An event-loop yield every 25 ticks allows a worker to receive cancellation.
 */
export async function runExperiment(options = {}) {
  object(options, 'options');
  const {
    config: inputConfig = {}, replicates = 4, ticks = 600,
    seeds: inputSeeds, onProgress, shouldCancel,
  } = options;
  integer(replicates, 'replicates', 1, EXPERIMENT_LIMITS.replicates);
  integer(ticks, 'ticks', 1, EXPERIMENT_LIMITS.ticks);
  for (const [name, callback] of Object.entries({ onProgress, shouldCancel })) {
    if (callback !== undefined && typeof callback !== 'function') throw new TypeError(`${name} must be a function.`);
  }
  const config = normalizeConfig(inputConfig);
  let seeds;
  if (inputSeeds !== undefined) {
    if (!Array.isArray(inputSeeds)) throw new TypeError('seeds must be an array.');
    integer(inputSeeds.length, 'seeds.length', 1, EXPERIMENT_LIMITS.replicates);
    seeds = Array.from(inputSeeds, (seed, index) => validSeed(seed, `seeds[${index}]`));
    if (new Set(seeds).size !== seeds.length) throw new RangeError('Experiment seeds must be unique.');
  } else {
    seeds = deriveSeeds(config.seed, replicates);
  }
  checkCancellation(shouldCancel);
  const rows = [];
  const report = (replicateIndex, tick, phase = 'running') => onProgress?.({
    completed: rows.length,
    total: seeds.length,
    fraction: phase === 'complete' ? 1 : (replicateIndex + tick / ticks) / seeds.length,
    replicate: replicateIndex + 1,
    seed: seeds[replicateIndex],
    tick,
    ticks,
    phase,
  });

  for (let index = 0; index < seeds.length; index += 1) {
    checkCancellation(shouldCancel);
    const pairedConfig = { ...config, seed: seeds[index] };
    const baseline = new Simulation({ ...pairedConfig, cooperation: 0 });
    const shared = new Simulation({ ...pairedConfig });
    report(index, 0);
    for (let tick = 0; tick < ticks;) {
      checkCancellation(shouldCancel);
      const count = Math.min(CHUNK_TICKS, ticks - tick);
      baseline.step(count);
      shared.step(count);
      tick += count;
      report(index, tick);
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkCancellation(shouldCancel);
    }
    const baselineMetrics = checkedMetrics(baseline);
    const sharedMetrics = checkedMetrics(shared);
    rows.push({
      seed: seeds[index],
      baseline: baselineMetrics,
      shared: sharedMetrics,
      delta: Object.fromEntries(METRIC_KEYS.map((key) => [key, sharedMetrics[key] - baselineMetrics[key]])),
    });
  }

  const summary = summarize(rows);
  const { meanDelta, standardError } = summary.foragers;
  const uncertainty = standardError === null
    ? 'Standard error is unavailable with one pair.'
    : `The standard error of the paired differences is ${standardError.toFixed(2)}.`;
  const result = {
    schemaVersion: 1,
    modelVersion: MODEL_VERSION,
    createdAt: new Date().toISOString(),
    config: { ...config },
    ticks,
    seeds: [...seeds],
    rows,
    summary,
    conclusion: `Across ${rows.length} paired seed${rows.length === 1 ? '' : 's'} at ${ticks} ticks, `
      + `shared information changed endpoint forager population by ${meanDelta >= 0 ? '+' : ''}${meanDelta.toFixed(2)} on average. `
      + `${uncertainty} These are descriptive results from this toy model, not proof of benefit or ecological validation. `
      + 'Identical initial seeds do not keep random events aligned after the arms diverge.',
  };
  report(seeds.length - 1, ticks, 'complete');
  return result;
}
