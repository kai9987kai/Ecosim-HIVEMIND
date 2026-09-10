/** A deterministic, intentionally simplified agent-based ecosystem. */
export const MODEL_VERSION = '1.0.0';
export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 680;
export const POPULATION_LIMIT = 400;

export const PRESETS = Object.freeze({
  meadow: Object.freeze({ name: 'Emerald meadow', description: 'A balanced habitat with abundant renewable food patches.', resourceCount: 270, foragers: 100, predators: 8, resourceRenewal: 0.0026, initialRichness: 0.8 }),
  dunes: Object.freeze({ name: 'Amber dunes', description: 'Sparse food and slow recovery put collective foraging under pressure.', resourceCount: 180, foragers: 80, predators: 6, resourceRenewal: 0.0021, initialRichness: 0.6 }),
  wetlands: Object.freeze({ name: 'Tidal wetlands', description: 'A productive habitat with denser populations and stronger predator pressure.', resourceCount: 330, foragers: 125, predators: 11, resourceRenewal: 0.0029, initialRichness: 0.9 }),
});

export const DEFAULT_CONFIG = Object.freeze({ seed: 'HIVE-0042', preset: 'meadow', cooperation: 0.72, mutationRate: 0.08, resourceRate: 1, seasonality: 0.55 });
const FIELD_COLS = 50;
const FIELD_ROWS = 34;
const CELL_SIZE = 50;
const TAU = Math.PI * 2;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, limit) => ((value % limit) + limit) % limit;
const delta = (from, to, limit) => {
  let distance = to - from;
  if (distance > limit / 2) distance -= limit;
  if (distance < -limit / 2) distance += limit;
  return distance;
};

function requireNumber(value, name, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new TypeError(`${name} must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`);
  }
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}

function validateConfig(partial, base = DEFAULT_CONFIG) {
  requireObject(partial, 'Configuration');
  for (const key of Object.keys(partial)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new TypeError(`Unknown configuration setting: ${key}.`);
  }
  const result = { ...base, ...partial };
  if (typeof result.seed !== 'string' || !result.seed.trim() || result.seed.length > 128) throw new TypeError('Seed must be a nonempty string of at most 128 characters.');
  if (typeof result.preset !== 'string' || !Object.hasOwn(PRESETS, result.preset)) throw new TypeError('Unknown habitat preset.');
  requireNumber(result.cooperation, 'Cooperation', 0, 1);
  requireNumber(result.mutationRate, 'Mutation rate', 0, 0.5);
  requireNumber(result.resourceRate, 'Resource renewal', 0, 3);
  requireNumber(result.seasonality, 'Seasonality', 0, 1);
  return result;
}

class Random {
  constructor(seed) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    this.state = hash >>> 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  between(min, max) { return min + (max - min) * this.next(); }
}

/** Toroidal spatial hash. Stable insertion and lookup order preserve repeatability. */
class SpatialGrid {
  constructor(items) {
    this.cols = Math.ceil(WORLD_WIDTH / CELL_SIZE);
    this.rows = Math.ceil(WORLD_HEIGHT / CELL_SIZE);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    for (const item of items) {
      const x = Math.floor(item.x / WORLD_WIDTH * this.cols);
      const y = Math.floor(item.y / WORLD_HEIGHT * this.rows);
      this.cells[y * this.cols + x].push(item);
    }
  }

  near(x, y, radius) {
    const col = Math.floor(x / WORLD_WIDTH * this.cols);
    const row = Math.floor(y / WORLD_HEIGHT * this.rows);
    const reachX = Math.ceil(radius / (WORLD_WIDTH / this.cols));
    const reachY = Math.ceil(radius / (WORLD_HEIGHT / this.rows));
    const found = [];
    for (let dy = -reachY; dy <= reachY; dy++) {
      for (let dx = -reachX; dx <= reachX; dx++) {
        const index = wrap(row + dy, this.rows) * this.cols + wrap(col + dx, this.cols);
        for (const item of this.cells[index]) found.push(item);
      }
    }
    return found;
  }
}

export class Simulation {
  constructor(options = {}) {
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.config = validateConfig(options);
    this.tick = 0;
    this._rng = new Random(this.config.seed);
    this._nextAgentId = 1;
    this._nextResourceId = 1;
    this._timers = { rain: 0, drought: 0 };
    this._highestGeneration = 0;
    this._counts = { births: 0, deaths: 0 };
    this.agents = [];
    this.resources = [];
    this.pheromones = { cols: FIELD_COLS, rows: FIELD_ROWS, values: Array(FIELD_COLS * FIELD_ROWS).fill(0) };
    this.history = [];
    // Events are chronological (oldest first), bounded to the latest 60 entries.
    this.events = [];
    const preset = PRESETS[this.config.preset];
    for (let i = 0; i < preset.resourceCount; i++) {
      this.resources.push({ id: this._nextResourceId++, x: this._rng.between(0, this.width), y: this._rng.between(0, this.height), amount: this._rng.between(0.25, preset.initialRichness), fertility: this._rng.between(0.7, 1.3) });
    }
    for (let i = 0; i < preset.foragers; i++) this.agents.push(this._createAgent('forager'));
    for (let i = 0; i < preset.predators; i++) this.agents.push(this._createAgent('predator'));
    this._resourceGrid = new SpatialGrid(this.resources);
    this._event('start', `${preset.name} initialized with seed ${this.config.seed}.`);
    this.history.push(this.metrics());
  }

  _createAgent(species, parent = null) {
    const predator = species === 'predator';
    const rng = this._rng;
    const mutate = (value, min, max, spread) => clamp(value + (rng.next() < this.config.mutationRate ? rng.between(-spread, spread) : 0), min, max);
    const traits = parent ? {
      speed: mutate(parent.traits.speed, predator ? 1.5 : 0.65, predator ? 3.3 : 2.6, 0.2),
      sense: mutate(parent.traits.sense, 35, 180, 12),
      cooperation: mutate(parent.traits.cooperation, 0, 1, 0.12),
    } : {
      speed: rng.between(predator ? 2 : 0.95, predator ? 2.7 : 1.85),
      sense: rng.between(predator ? 115 : 65, predator ? 160 : 120),
      cooperation: rng.between(0.5, 1),
    };
    return {
      id: this._nextAgentId++, species,
      x: parent ? wrap(parent.x + rng.between(-12, 12), this.width) : rng.between(0, this.width),
      y: parent ? wrap(parent.y + rng.between(-12, 12), this.height) : rng.between(0, this.height),
      angle: rng.between(0, TAU),
      energy: parent ? (predator ? 85 : 57) : rng.between(predator ? 115 : 65, predator ? 165 : 105),
      age: 0,
      generation: parent ? parent.generation + 1 : 0,
      reproductionCooldown: parent ? 140 : Math.floor(rng.between(40, 120)),
      lifespan: Math.floor(rng.between(predator ? 2300 : 1700, predator ? 3300 : 2600)),
      traits,
    };
  }

  _event(type, message) {
    this.events.push({ tick: this.tick, type, message });
    if (this.events.length > 60) this.events.shift();
  }

  /** Seed and habitat describe initialization; create a new instance to change them. */
  updateConfig(partial) {
    const next = validateConfig(partial, this.config);
    if (next.seed !== this.config.seed || next.preset !== this.config.preset) throw new TypeError('Changing seed or habitat requires a new simulation.');
    this.config = next;
    return this;
  }

  intervene(type) {
    if (!['rain', 'drought', 'bloom', 'predators'].includes(type)) throw new TypeError('Unknown intervention.');
    if (type === 'rain') {
      this._timers.rain = 300;
      this._timers.drought = 0;
      for (const resource of this.resources) resource.amount = Math.min(1, resource.amount + 0.12);
      this._event(type, 'Rain pulse: food renewal doubles for 300 ticks.');
    } else if (type === 'drought') {
      this._timers.drought = 400;
      this._timers.rain = 0;
      for (const resource of this.resources) resource.amount *= 0.55;
      this._event(type, 'Drought: food renewal falls to 15% for 400 ticks.');
    } else if (type === 'bloom') {
      for (const resource of this.resources) resource.amount = Math.min(1, resource.amount + 0.65);
      this._event(type, 'Resource bloom replenished every food patch.');
    } else {
      const count = Math.min(4, POPULATION_LIMIT - this.agents.length);
      for (let i = 0; i < count; i++) this.agents.push(this._createAgent('predator'));
      this._event(type, `${count} predators introduced into the habitat.`);
    }
    return this;
  }

  _fieldIndex(x, y) {
    return Math.floor(y / this.height * FIELD_ROWS) * FIELD_COLS + Math.floor(x / this.width * FIELD_COLS);
  }

  _fieldDirection(agent) {
    const values = this.pheromones.values;
    const col = Math.floor(agent.x / this.width * FIELD_COLS);
    const row = Math.floor(agent.y / this.height * FIELD_ROWS);
    let x = 0;
    let y = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const strength = values[wrap(row + dy, FIELD_ROWS) * FIELD_COLS + wrap(col + dx, FIELD_COLS)] / (dx * dx + dy * dy);
        x += dx * strength;
        y += dy * strength;
      }
    }
    return { x, y };
  }

  step(count = 1) {
    requireNumber(count, 'Step count', 0, 10000, true);
    for (let i = 0; i < count; i++) this._stepOnce();
    return this;
  }

  _stepOnce() {
    this.tick++;
    const seasonWave = Math.sin(this.tick / 1600 * TAU);
    const seasonal = 1 + seasonWave * this.config.seasonality * 0.75;
    const weather = this._timers.drought > 0 ? 0.15 : this._timers.rain > 0 ? 2 : 1;
    const renewal = PRESETS[this.config.preset].resourceRenewal * this.config.resourceRate * seasonal * weather;
    for (const resource of this.resources) resource.amount = Math.min(1, resource.amount + renewal * resource.fertility);
    if (this._timers.rain > 0) this._timers.rain--;
    if (this._timers.drought > 0) this._timers.drought--;
    const field = this.pheromones.values;
    for (let i = 0; i < field.length; i++) field[i] = field[i] < 0.00001 ? 0 : field[i] * 0.985;

    // All steering reads a stable pre-movement neighborhood to avoid iteration-order drift.
    const grid = new SpatialGrid(this.agents.map(agent => ({ ...agent })));
    const dead = new Set();
    const newborns = [];
    let initialForagers = 0;
    let initialPredators = 0;
    const livingById = new Map(this.agents.map(agent => [agent.id, agent]));
    for (const agent of this.agents) {
      if (agent.species === 'forager') initialForagers++; else initialPredators++;
      if (dead.has(agent.id)) continue;
      const predator = agent.species === 'predator';
      agent.age++;
      agent.reproductionCooldown = Math.max(0, agent.reproductionCooldown - 1);
      const cooperation = this.config.cooperation * agent.traits.cooperation;
      const neighbors = grid.near(agent.x, agent.y, agent.traits.sense);
      let forceX = Math.cos(agent.angle) * 0.7;
      let forceY = Math.sin(agent.angle) * 0.7;
      let closestPrey = null;
      let preyDistance = Infinity;
      let fleeing = false;
      for (const neighbor of neighbors) {
        if (neighbor.id === agent.id || dead.has(neighbor.id)) continue;
        const dx = delta(agent.x, neighbor.x, this.width);
        const dy = delta(agent.y, neighbor.y, this.height);
        const distance = Math.hypot(dx, dy);
        if (distance > agent.traits.sense || distance < 0.001) continue;
        if (predator && neighbor.species === 'forager' && distance < preyDistance) {
          closestPrey = neighbor;
          preyDistance = distance;
        } else if (!predator && neighbor.species === 'predator' && distance < 80) {
          const strength = (1 - distance / 100) * 6;
          forceX -= dx / distance * strength;
          forceY -= dy / distance * strength;
          fleeing = true;
        } else if (!predator && neighbor.species === 'forager') {
          if (distance < 16) {
            forceX -= dx / distance * 0.4;
            forceY -= dy / distance * 0.4;
          } else {
            // Weak local alignment; stronger resource signals carry most cooperation.
            forceX += Math.cos(neighbor.angle) * cooperation * 0.025;
            forceY += Math.sin(neighbor.angle) * cooperation * 0.025;
          }
        }
      }

      let food = null;
      if (predator && closestPrey) {
        forceX += delta(agent.x, closestPrey.x, this.width) / preyDistance * 3.5;
        forceY += delta(agent.y, closestPrey.y, this.height) / preyDistance * 3.5;
      } else if (!predator) {
        let bestValue = -Infinity;
        for (const resource of this._resourceGrid.near(agent.x, agent.y, agent.traits.sense)) {
          if (resource.amount < 0.045) continue;
          const dx = delta(agent.x, resource.x, this.width);
          const dy = delta(agent.y, resource.y, this.height);
          const distance = Math.hypot(dx, dy);
          if (distance > agent.traits.sense) continue;
          const value = resource.amount / (distance + 14);
          if (value > bestValue) { food = resource; bestValue = value; }
        }
        if (food) {
          const dx = delta(agent.x, food.x, this.width);
          const dy = delta(agent.y, food.y, this.height);
          const distance = Math.max(1, Math.hypot(dx, dy));
          forceX += dx / distance * (fleeing ? 0.5 : 2.8);
          forceY += dy / distance * (fleeing ? 0.5 : 2.8);
        }
        if (cooperation > 0 && !fleeing) {
          const direction = this._fieldDirection(agent);
          const magnitude = Math.hypot(direction.x, direction.y);
          if (magnitude > 0.02) {
            const strength = cooperation * (food ? 0.3 : 1.6) * Math.min(1, magnitude);
            forceX += direction.x / magnitude * strength;
            forceY += direction.y / magnitude * strength;
          }
        }
      }

      // Every living agent draws one random turn per step, including those with targets.
      const noise = this._rng.between(-0.22, 0.22);
      const desiredAngle = Math.atan2(forceY, forceX) + noise;
      const turn = Math.atan2(Math.sin(desiredAngle - agent.angle), Math.cos(desiredAngle - agent.angle));
      agent.angle = wrap(agent.angle + clamp(turn, -0.32, 0.32), TAU);
      const speed = agent.traits.speed * (fleeing ? 1.35 : 1);
      agent.x = wrap(agent.x + Math.cos(agent.angle) * speed, this.width);
      agent.y = wrap(agent.y + Math.sin(agent.angle) * speed, this.height);
      agent.energy -= (predator ? 0.155 : 0.115) + speed * speed * 0.016 + agent.traits.sense * 0.00016;

      if (predator && closestPrey && preyDistance < 11) {
        const prey = livingById.get(closestPrey.id);
        if (prey && !dead.has(prey.id)) {
          dead.add(prey.id);
          agent.energy = Math.min(220, agent.energy + 67);
        }
      } else if (!predator && food) {
        const distance = Math.hypot(delta(agent.x, food.x, this.width), delta(agent.y, food.y, this.height));
        if (distance < 13) {
          const eaten = Math.min(food.amount, 0.042);
          food.amount -= eaten;
          agent.energy = Math.min(155, agent.energy + eaten * 53);
          if (cooperation > 0 && food.amount > 0.1) {
            const index = this._fieldIndex(food.x, food.y);
            field[index] = Math.min(10, field[index] + cooperation * food.amount * 0.4);
          }
        }
      }

      if (agent.energy <= 0 || agent.age >= agent.lifespan) {
        dead.add(agent.id);
        continue;
      }
      if (agent.energy > (predator ? 188 : 132) && agent.age > 140 && agent.reproductionCooldown === 0 && this.agents.length + newborns.length - dead.size < POPULATION_LIMIT) {
        const child = this._createAgent(agent.species, agent);
        agent.energy -= predator ? 95 : 66;
        agent.reproductionCooldown = predator ? 230 : 160;
        newborns.push(child);
        this._counts.births++;
        if (child.generation > this._highestGeneration) {
          this._highestGeneration = child.generation;
          this._event('generation', `Generation ${child.generation} emerged through inherited traits.`);
        }
      }
    }
    this._counts.deaths += dead.size;
    this.agents = this.agents.filter(agent => !dead.has(agent.id)).concat(newborns);
    const foragers = this.agents.filter(agent => agent.species === 'forager').length;
    const predators = this.agents.length - foragers;
    if (initialForagers > 0 && foragers === 0) this._event('extinction', 'The forager population became extinct.');
    if (initialPredators > 0 && predators === 0) this._event('extinction', 'The predator population became extinct.');
    if (this.tick % 10 === 0) {
      this.history.push(this.metrics());
      if (this.history.length > 180) this.history.shift();
    }
  }

  metrics() {
    const foragers = this.agents.filter(agent => agent.species === 'forager');
    const bins = new Map();
    let energy = 0;
    let cooperation = 0;
    let generation = 0;
    for (const agent of this.agents) {
      energy += agent.energy;
      generation = Math.max(generation, agent.generation);
    }
    // Shannon entropy over 4 x 4 forager speed/sensing bins, normalized by log(16).
    // This measures behavioral trait spread; it is not ecological species diversity.
    for (const agent of foragers) {
      const speedBin = clamp(Math.floor((agent.traits.speed - 0.65) / 1.95 * 4), 0, 3);
      const senseBin = clamp(Math.floor((agent.traits.sense - 35) / 145 * 4), 0, 3);
      const key = speedBin * 4 + senseBin;
      bins.set(key, (bins.get(key) || 0) + 1);
      cooperation += agent.traits.cooperation * this.config.cooperation;
    }
    let entropy = 0;
    for (const count of bins.values()) {
      const probability = count / foragers.length;
      entropy -= probability * Math.log(probability);
    }
    return {
      tick: this.tick,
      population: this.agents.length,
      foragers: foragers.length,
      predators: this.agents.length - foragers.length,
      plants: this.resources.filter(resource => resource.amount > 0.15).length,
      meanEnergy: this.agents.length ? energy / this.agents.length : 0,
      diversity: entropy / Math.log(16),
      generation,
      cooperation: foragers.length ? cooperation / foragers.length : 0,
      season: SEASONS[Math.floor((this.tick % 1600) / 400)],
      births: this._counts.births,
      deaths: this._counts.deaths,
    };
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      schemaVersion: 1, modelVersion: MODEL_VERSION,
      width: this.width, height: this.height, config: this.config, tick: this.tick,
      rngState: this._rng.state, nextAgentId: this._nextAgentId, nextResourceId: this._nextResourceId,
      timers: this._timers, highestGeneration: this._highestGeneration, counts: this._counts,
      agents: this.agents, resources: this.resources, pheromones: this.pheromones,
      history: this.history, events: this.events,
    }));
  }

  static fromSnapshot(input) {
    requireObject(input, 'Snapshot');
    if (input.schemaVersion !== 1 || input.modelVersion !== MODEL_VERSION) throw new TypeError('Unsupported snapshot version.');
    if (input.width !== WORLD_WIDTH || input.height !== WORLD_HEIGHT) throw new TypeError('Snapshot world dimensions do not match this model.');
    requireObject(input.config, 'Snapshot configuration');
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (!Object.hasOwn(input.config, key)) throw new TypeError(`Snapshot configuration is missing ${key}.`);
    }
    const config = validateConfig(input.config);
    const tick = requireNumber(input.tick, 'Snapshot tick', 0, 1e9, true);
    const rngState = requireNumber(input.rngState, 'Random state', 0, 4294967295, true);
    const nextAgentId = requireNumber(input.nextAgentId, 'Next agent id', 1, 1e9, true);
    const nextResourceId = requireNumber(input.nextResourceId, 'Next resource id', 1, 1e9, true);
    const highestGeneration = requireNumber(input.highestGeneration, 'Highest generation', 0, 1e7, true);
    requireObject(input.timers, 'Intervention timers');
    const timers = { rain: requireNumber(input.timers.rain, 'Rain timer', 0, 300, true), drought: requireNumber(input.timers.drought, 'Drought timer', 0, 400, true) };
    if (timers.rain > 0 && timers.drought > 0) throw new TypeError('Rain and drought cannot be active together.');
    requireObject(input.counts, 'Event counts');
    const counts = { births: requireNumber(input.counts.births, 'Birth count', 0, 1e9, true), deaths: requireNumber(input.counts.deaths, 'Death count', 0, 1e9, true) };
    if (!Array.isArray(input.agents) || input.agents.length > POPULATION_LIMIT) throw new TypeError('Snapshot population exceeds the model limit.');
    const agentIds = new Set();
    const agents = input.agents.map((item) => {
      requireObject(item, 'Agent');
      const id = requireNumber(item.id, 'Agent id', 1, nextAgentId - 1, true);
      if (agentIds.has(id)) throw new TypeError('Duplicate agent id.');
      agentIds.add(id);
      if (!['forager', 'predator'].includes(item.species)) throw new TypeError('Unknown agent species.');
      requireObject(item.traits, 'Agent traits');
      const predator = item.species === 'predator';
      const x = requireNumber(item.x, 'Agent x', 0, WORLD_WIDTH);
      const y = requireNumber(item.y, 'Agent y', 0, WORLD_HEIGHT);
      if (x === WORLD_WIDTH || y === WORLD_HEIGHT) throw new TypeError('Agent coordinates must fall within the world.');
      const lifespan = requireNumber(item.lifespan, 'Agent lifespan', 1700, 3300, true);
      return {
        id, species: item.species, x, y,
        angle: requireNumber(item.angle, 'Agent angle', 0, TAU),
        energy: requireNumber(item.energy, 'Agent energy', Number.MIN_VALUE, predator ? 220 : 155),
        age: requireNumber(item.age, 'Agent age', 0, lifespan - 1, true),
        generation: requireNumber(item.generation, 'Agent generation', 0, highestGeneration, true),
        reproductionCooldown: requireNumber(item.reproductionCooldown, 'Reproduction cooldown', 0, 230, true),
        lifespan,
        traits: {
          speed: requireNumber(item.traits.speed, 'Agent speed', predator ? 1.5 : 0.65, predator ? 3.3 : 2.6),
          sense: requireNumber(item.traits.sense, 'Agent sensing radius', 35, 180),
          cooperation: requireNumber(item.traits.cooperation, 'Agent cooperation trait', 0, 1),
        },
      };
    });
    if (!Array.isArray(input.resources) || input.resources.length !== PRESETS[config.preset].resourceCount) throw new TypeError('Snapshot food patch count does not match its habitat.');
    const resourceIds = new Set();
    const resources = input.resources.map(item => {
      requireObject(item, 'Food patch');
      const id = requireNumber(item.id, 'Food patch id', 1, nextResourceId - 1, true);
      if (resourceIds.has(id)) throw new TypeError('Duplicate food patch id.');
      resourceIds.add(id);
      const x = requireNumber(item.x, 'Food patch x', 0, WORLD_WIDTH);
      const y = requireNumber(item.y, 'Food patch y', 0, WORLD_HEIGHT);
      if (x === WORLD_WIDTH || y === WORLD_HEIGHT) throw new TypeError('Food patch coordinates must fall within the world.');
      return { id, x, y, amount: requireNumber(item.amount, 'Food patch amount', 0, 1), fertility: requireNumber(item.fertility, 'Food patch fertility', 0.7, 1.3) };
    });
    requireObject(input.pheromones, 'Pheromone field');
    const field = input.pheromones;
    if (field.cols !== FIELD_COLS || field.rows !== FIELD_ROWS || !Array.isArray(field.values) || field.values.length !== FIELD_COLS * FIELD_ROWS) throw new TypeError('Invalid pheromone field dimensions.');
    const values = field.values.map(value => requireNumber(value, 'Pheromone intensity', 0, 10));
    if (!Array.isArray(input.history) || input.history.length > 180) throw new TypeError('Invalid history length.');
    let previousTick = -1;
    const history = input.history.map(item => {
      requireObject(item, 'History sample');
      const result = {};
      for (const key of ['tick', 'population', 'foragers', 'predators', 'plants', 'generation', 'births', 'deaths']) {
        result[key] = requireNumber(item[key], `History ${key}`, 0, key === 'tick' ? tick : key === 'plants' ? resources.length : ['population', 'foragers', 'predators'].includes(key) ? POPULATION_LIMIT : 1e9, true);
      }
      if (result.tick <= previousTick || result.population !== result.foragers + result.predators) throw new TypeError('Inconsistent history sample.');
      previousTick = result.tick;
      result.meanEnergy = requireNumber(item.meanEnergy, 'History energy', 0, 220);
      result.diversity = requireNumber(item.diversity, 'History diversity', 0, 1.000000001);
      result.cooperation = requireNumber(item.cooperation, 'History cooperation', 0, 1);
      if (!SEASONS.includes(item.season)) throw new TypeError('Invalid season in history.');
      result.season = item.season;
      return result;
    });
    if (!Array.isArray(input.events) || input.events.length > 60) throw new TypeError('Invalid event log length.');
    previousTick = -1;
    const eventTypes = ['start', 'rain', 'drought', 'bloom', 'predators', 'generation', 'extinction'];
    const events = input.events.map(item => {
      requireObject(item, 'Event');
      const eventTick = requireNumber(item.tick, 'Event tick', 0, tick, true);
      if (eventTick < previousTick || !eventTypes.includes(item.type) || typeof item.message !== 'string' || item.message.length > 300) throw new TypeError('Invalid event log entry.');
      previousTick = eventTick;
      return { tick: eventTick, type: item.type, message: item.message };
    });
    // Construct without consuming random numbers or retaining references to untrusted input.
    const simulation = Object.create(Simulation.prototype);
    Object.assign(simulation, {
      width: WORLD_WIDTH, height: WORLD_HEIGHT, config, tick,
      _rng: Object.assign(Object.create(Random.prototype), { state: rngState }),
      _nextAgentId: nextAgentId, _nextResourceId: nextResourceId,
      _timers: timers, _highestGeneration: highestGeneration, _counts: counts,
      agents, resources, pheromones: { cols: FIELD_COLS, rows: FIELD_ROWS, values }, history, events,
      _resourceGrid: new SpatialGrid(resources),
    });
    return simulation;
  }
}
