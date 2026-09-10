import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, MODEL_VERSION, POPULATION_LIMIT, PRESETS, Simulation } from '../src/simulation.js';

const clone = value => JSON.parse(JSON.stringify(value));

function assertInvariants(simulation) {
  const metrics = simulation.metrics();
  assert.equal(metrics.population, simulation.agents.length);
  assert.equal(metrics.population, metrics.foragers + metrics.predators);
  assert.ok(metrics.population <= POPULATION_LIMIT);
  assert.ok(metrics.diversity >= 0 && metrics.diversity <= 1.000000001);
  assert.ok(metrics.cooperation >= 0 && metrics.cooperation <= simulation.config.cooperation);
  assert.ok(Number.isFinite(metrics.meanEnergy));
  assert.equal(simulation.resources.length, PRESETS[simulation.config.preset].resourceCount);
  assert.equal(new Set(simulation.agents.map(agent => agent.id)).size, simulation.agents.length);
  for (const agent of simulation.agents) {
    assert.ok(Number.isFinite(agent.x) && agent.x >= 0 && agent.x < simulation.width);
    assert.ok(Number.isFinite(agent.y) && agent.y >= 0 && agent.y < simulation.height);
    assert.ok(Number.isFinite(agent.angle));
    assert.ok(agent.energy > 0 && agent.energy <= (agent.species === 'predator' ? 220 : 155));
    assert.ok(agent.age < agent.lifespan);
    assert.ok(agent.traits.speed >= 0.65 && agent.traits.speed <= 3.3);
    assert.ok(agent.traits.sense >= 35 && agent.traits.sense <= 180);
    assert.ok(agent.traits.cooperation >= 0 && agent.traits.cooperation <= 1);
  }
  for (const resource of simulation.resources) assert.ok(Number.isFinite(resource.amount) && resource.amount >= 0 && resource.amount <= 1);
  for (const value of simulation.pheromones.values) assert.ok(Number.isFinite(value) && value >= 0 && value <= 10);
  assert.ok(simulation.history.length <= 180);
  assert.ok(simulation.events.length <= 60);
}

test('same seed reproduces all state; different seed changes initialization', () => {
  const first = new Simulation({ seed: 'repeatable-habitat' });
  const second = new Simulation({ seed: 'repeatable-habitat' });
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.notDeepEqual(first.resources, new Simulation({ seed: 'another-habitat' }).resources);
  first.step(180);
  second.step(180);
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('step batching and rendering cadence cannot change logical results', () => {
  const batched = new Simulation({ seed: 'frame-independent' });
  const individual = new Simulation({ seed: 'frame-independent' });
  batched.step(240);
  for (let i = 0; i < 240; i++) {
    individual.metrics(); // Reading state must never draw randomness or change the world.
    if (i % 17 === 0) individual.snapshot();
    individual.step();
  }
  assert.deepEqual(batched.snapshot(), individual.snapshot());
  const unchanged = batched.snapshot();
  assert.equal(batched.step(0), batched);
  assert.deepEqual(batched.snapshot(), unchanged);
});

test('JSON snapshot resumes exactly through weather, reproduction and parameter changes', () => {
  const original = new Simulation({ seed: 'portable-world', preset: 'wetlands', mutationRate: 0.3 });
  original.step(200).intervene('rain').step(67);
  const exported = original.snapshot();
  assert.equal(exported.modelVersion, MODEL_VERSION);
  const resumed = Simulation.fromSnapshot(clone(exported));
  assert.deepEqual(resumed.snapshot(), exported);
  // Restored data must not share references with caller-owned import data.
  exported.agents[0].x = 999;
  exported.pheromones.values[0] = 10;
  exported.config.cooperation = 0;
  original.updateConfig({ cooperation: 0.35 }).step(250).intervene('predators').step(33);
  resumed.updateConfig({ cooperation: 0.35 }).step(250).intervene('predators').step(33);
  assert.deepEqual(resumed.snapshot(), original.snapshot());
  assert.ok(resumed.metrics().births > 0);
});

test('untrusted imports reject malformed state instead of silently changing the model', () => {
  const valid = new Simulation().step(20).snapshot();
  const mutations = [
    value => { value.schemaVersion = 99; },
    value => { value.modelVersion = 'unknown'; },
    value => { value.width = 400; },
    value => { value.config.cooperation = -1; },
    value => { value.config.preset = ['meadow']; },
    value => { value.config.preset = [['meadow']]; },
    value => { delete value.config.seed; },
    value => { value.rngState = -1; },
    value => { value.tick = 0.5; },
    value => { value.agents[0].x = NaN; },
    value => { value.agents[0].y = value.height; },
    value => { value.agents[0].energy = Infinity; },
    value => { value.agents[0].species = 'dragon'; },
    value => { value.agents[0].traits.speed = 999; },
    value => { value.agents[1].id = value.agents[0].id; },
    value => { value.nextAgentId = 1; },
    value => { value.agents = Array(401).fill(value.agents[0]); },
    value => { value.resources.pop(); },
    value => { value.resources[0].amount = -0.1; },
    value => { value.resources[0].fertility = 5; },
    value => { value.resources[1].id = value.resources[0].id; },
    value => { value.pheromones.values.pop(); },
    value => { value.pheromones.values[0] = -1; },
    value => { value.timers = { rain: 1, drought: 1 }; },
    value => { value.history[0].tick = 99; },
    value => { value.history[0].population = 3; },
    value => { value.history[0].diversity = 2; },
    value => { value.events[0].type = 'unsupported'; },
    value => { value.events[0].message = 'x'.repeat(301); },
  ];
  for (const mutate of mutations) {
    const invalid = clone(valid);
    mutate(invalid);
    assert.throws(() => Simulation.fromSnapshot(invalid), TypeError, mutate.toString());
  }
  for (const invalid of [null, [], 'snapshot', undefined]) assert.throws(() => Simulation.fromSnapshot(invalid), TypeError);
  assert.deepEqual(Simulation.fromSnapshot(valid).snapshot(), valid);
});

test('interventions have observable, bounded effects and weather durations expire exactly', () => {
  const simulation = new Simulation();
  const amount = () => simulation.resources.reduce((sum, resource) => sum + resource.amount, 0);
  const baseline = amount();
  simulation.intervene('drought');
  assert.ok(amount() < baseline * 0.56);
  assert.equal(simulation.snapshot().timers.drought, 400);
  simulation.intervene('rain');
  assert.equal(simulation.snapshot().timers.drought, 0);
  assert.equal(simulation.snapshot().timers.rain, 300);
  const beforeBloom = amount();
  simulation.intervene('bloom');
  assert.ok(amount() > beforeBloom);
  const predatorCount = simulation.metrics().predators;
  simulation.intervene('predators');
  assert.equal(simulation.metrics().predators, predatorCount + 4);
  simulation.step(300);
  assert.deepEqual(simulation.snapshot().timers, { rain: 0, drought: 0 });
  const beforeBadAction = simulation.snapshot();
  assert.throws(() => simulation.intervene('meteor'), TypeError);
  assert.deepEqual(simulation.snapshot(), beforeBadAction);
  assertInvariants(simulation);
});

test('rain and drought change renewal rates in the absence of consumers', () => {
  const base = new Simulation({ seasonality: 0 }).snapshot();
  base.agents = [];
  for (const resource of base.resources) resource.amount = 0;
  const rain = Simulation.fromSnapshot(base).intervene('rain');
  const drought = Simulation.fromSnapshot(base).intervene('drought');
  // Cancel the instantaneous resource pulse to isolate the renewal treatment.
  for (const resource of rain.resources) resource.amount = 0;
  rain.step(10);
  drought.step(10);
  const rainAmount = rain.resources[0].amount;
  const droughtAmount = drought.resources[0].amount;
  assert.ok(Math.abs(rainAmount / droughtAmount - 2 / 0.15) < 1e-10);
});

test('cooperation ablation preserves initial conditions and changes actual behavior', () => {
  const isolated = new Simulation({ seed: 'controlled-ablation', cooperation: 0 });
  const shared = new Simulation({ seed: 'controlled-ablation', cooperation: 1 });
  assert.deepEqual(isolated.agents, shared.agents);
  assert.deepEqual(isolated.resources, shared.resources);
  isolated.step(160);
  shared.step(160);
  assert.ok(isolated.pheromones.values.every(value => value === 0));
  assert.ok(shared.pheromones.values.some(value => value > 0));
  assert.notDeepEqual(isolated.agents, shared.agents);
  assert.equal(isolated.metrics().cooperation, 0);
  assert.ok(shared.metrics().cooperation > 0);
  // This verifies the mechanism, not a claim that cooperation always improves survival.
});

test('inherited traits remain bounded and zero mutation copies the parent traits', () => {
  const simulation = new Simulation({ mutationRate: 0 });
  const founderTraits = new Set(simulation.agents.map(agent => JSON.stringify(agent.traits)));
  simulation.step(450);
  assert.ok(simulation.metrics().births > 0);
  const offspring = simulation.agents.filter(agent => agent.generation > 0);
  assert.ok(offspring.length > 0);
  assert.ok(offspring.every(agent => founderTraits.has(JSON.stringify(agent.traits))));
  assertInvariants(simulation);
});

test('all habitats sustain births and deaths while long runs preserve bounds', () => {
  for (const preset of Object.keys(PRESETS)) {
    const simulation = new Simulation({ preset });
    for (let batch = 0; batch < 10; batch++) {
      simulation.step(200);
      assertInvariants(simulation);
    }
    assert.ok(simulation.metrics().births > 0, `${preset} should permit reproduction`);
    assert.ok(simulation.metrics().deaths > 0, `${preset} should have mortality`);
    assert.ok(simulation.metrics().foragers > 0, `${preset} default seed remains viable at tick 2000`);
    assert.equal(simulation.history.length, 180);
    assert.equal(simulation.history.at(-1).tick, 2000);
    assert.deepEqual(Simulation.fromSnapshot(simulation.snapshot()).snapshot(), simulation.snapshot());
  }
});

test('population cap and event log bounds survive repeated predator introductions', () => {
  const simulation = new Simulation();
  for (let i = 0; i < 100; i++) simulation.intervene('predators');
  assert.equal(simulation.agents.length, POPULATION_LIMIT);
  assert.equal(simulation.events.length, 60);
  simulation.step(20);
  assertInvariants(simulation);
});

test('configuration and step validation are atomic', () => {
  const simulation = new Simulation();
  assert.deepEqual(simulation.config, DEFAULT_CONFIG);
  for (const config of [{ seed: '' }, { seed: 42 }, { preset: 'unknown' }, { preset: ['meadow'] }, { preset: { toString: () => 'meadow' } }, { cooperation: NaN }, { mutationRate: 1 }, { resourceRate: -1 }, { seasonality: Infinity }, { unknown: 1 }]) {
    assert.throws(() => new Simulation(config), TypeError);
  }
  for (const config of [{ cooperation: 2 }, { seed: 'different' }, { preset: 'dunes' }, { preset: ['meadow'] }]) {
    assert.throws(() => simulation.updateConfig(config), TypeError);
    assert.deepEqual(simulation.config, DEFAULT_CONFIG);
  }
  for (const count of [-1, 0.5, Infinity, NaN, '2', 10001]) assert.throws(() => simulation.step(count), TypeError);
  assert.equal(simulation.tick, 0);
  simulation.updateConfig({ cooperation: 0.2, mutationRate: 0.4 });
  assert.equal(simulation.config.cooperation, 0.2);
  assert.equal(simulation.config.mutationRate, 0.4);
});
