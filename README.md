# Ecosim HIVEMIND

A local ecosystem simulation lab for watching collective foraging, inherited variation, and predator–prey dynamics. Explore a seeded world, inspect individual organisms, change its conditions, and compare shared signals against an independent baseline.


The browser interface includes a responsive landscape, resource and signal overlays, population histories, a keyboard-accessible organism inspector, and a research notebook. The underlying model is deliberately small and explicit: its measurements describe programmed agents, not real species or learned intelligence.

## Run locally

Use **Node.js 22 or newer** and a current browser. From the project directory:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The application and local server have no runtime package dependencies; `npm install` is only needed for the browser testing tools. Stop the server with `Ctrl+C`.

The server binds to `127.0.0.1` and serves the application assets and research notes. Simulations, experiments, and JSON imports run on your device. There are no accounts, analytics, remote model services, or upload endpoints. Research links open external publisher pages when selected. This server is intended for local use.

## Explore a world

1. Start with the default **Emerald meadow**, seed `HIVE-0042`, or choose **New world** to set a habitat and seed. Reusing a seed and the same settings reproduces the starting state.
2. Pause, resume, advance one tick, or choose **1×**, **2×**, or **4×** playback. Normal playback targets 30 simulation ticks per second. Speed changes how quickly ticks are scheduled; each tick uses the same model rules.
3. Choose **Organisms**, **Signals**, or **Resources** to inspect different map layers. Click an organism or use the selector beneath the habitat to inspect its energy, traits, and generation.
4. Adjust resource renewal, seasonal variation, shared signals, and mutation rate. Sliders affect the current world. Changing the habitat preset starts a fresh world; reset restarts the current seed with the current settings.
5. Apply **Rainfall**, **Food bloom**, **Drought**, or **+ Predators**, then watch the population history and field notes.

`Space` pauses or resumes, `F` toggles fullscreen, and `Escape` closes a dialog or leaves fullscreen. Use Tab and the standard arrow-key controls to navigate buttons, sliders, and the organism selector.

**Save world** downloads a JSON snapshot. **Load** validates a snapshot and restores the world paused. Snapshots preserve model state, random-generator state, agents, resources, signals, intervention timers, history, and event counts so subsequent ticks can continue exactly under the same model version. Keep a downloaded snapshot before replacing a world or closing the page; there is no automatic cloud save.

## Compare shared signals

Open **Experiments**, select **4, 8, or 12 paired seeds** and **600, 1,500, or 3,000 ticks**, then run the comparison. Experiments run in a separate worker and can be cancelled.

Each pair creates two fresh worlds with identical initial seeds and habitat settings. The independent arm sets cooperation to zero; the collective arm uses your selected shared-signal value. The comparison starts at tick zero and does not inherit the interactive world's organisms or interventions. Settings are captured when the experiment starts.

Results retain both arms' endpoint metrics and each `collective − independent` difference. Summaries report arm means, the mean paired difference, and its sample standard error, `SD(differences) / sqrt(number of pairs)`. These are descriptive outcomes, with no significance claim or ecological validation. Initial seed pairing does not guarantee that later random events remain aligned once births and deaths differ.

**Export JSON** saves the actual rows, summaries, seeds, configuration, tick horizon, timestamp, schema version, and model version. For repeatable comparisons, retain that export and the same source version. The runner also supports 1–12 explicitly supplied unique string seeds; a single pair has an unavailable standard error, represented as `null`.

## Model rules and assumptions

The world is a **1,000 × 680 continuous space with wrapping edges**, capped at **400 total agents**. Illustrated terrain is decorative: water, rocks, and vegetation do not block movement. A spatial grid accelerates local sensing; it does not change the world into discrete agent positions.

| Habitat | Initial foragers | Initial predators | Food patches | Base food renewal per tick |
| --- | ---: | ---: | ---: | ---: |
| Emerald meadow | 100 | 8 | 270 | 0.0026 |
| Amber dunes | 80 | 6 | 180 | 0.0021 |
| Tidal wetlands | 125 | 11 | 330 | 0.0029 |

- **Food:** Each fixed patch holds a normalized amount from 0 to 1. Every tick it gains `base renewal × resourceRate × fertility × seasonal factor × weather factor`, capped at 1. Fertility is fixed per patch in `[0.7, 1.3]`. The seasonal factor is `1 + 0.75 × seasonality × sin(2π × tick / 1600)`; each named season lasts 400 ticks.
- **Movement:** Foragers seek nearby food, avoid predators, and separate from close neighbors. Predators pursue nearby foragers. Steering includes bounded turning and seeded random variation. Effective cooperation is `shared-signal setting × inherited cooperation trait`; it controls weak neighbor alignment and response to food signals.
- **Signals:** A 50 × 34 field stores signals at feeding sites. Feeding foragers can deposit `effective cooperation × remaining food × 0.4`, capped at 10 per cell. Signals decay by a factor of `0.985` each tick, with tiny values cleared. Foragers can follow the nearby field; there is no neural policy or learned communication protocol.
- **Energy and feeding:** Per-tick energy cost is `base cost + 0.016 × movement speed² + 0.00016 × sensing radius`, where base cost is 0.115 for foragers and 0.155 for predators. A forager eats at most 0.042 food per tick and gains `53 × food eaten`, up to 155 energy. A successful predator gains 67 energy, up to 220. Depleted energy or reaching a sampled lifespan causes death.
- **Inheritance:** Agents older than 140 ticks can reproduce when their cooldown is zero, capacity is available, and energy exceeds 132 for foragers or 188 for predators. Offspring inherit speed, sensing radius, and cooperation, with an independent mutation chance for each trait. Mutations are bounded numeric changes; agents remain within the same predefined behaviors and trait ranges.
- **Metrics:** Population counts living agents. Available resources counts patches with food above 0.15. Trait diversity is normalized Shannon entropy over 16 forager speed/sensing bins, `−Σ p log(p) / log(16)`, and is zero when no foragers remain. Generation is the highest generation currently alive. These measures do not establish ecosystem health or open-ended evolution.

Rainfall immediately adds up to 0.12 food per patch and doubles renewal for 300 ticks. Drought multiplies current food by 0.55 and reduces renewal to 15% for 400 ticks. These weather effects replace each other. Food bloom adds up to 0.65 food per patch. Introducing predators adds at most four agents, subject to the population cap.

See the [research notes and model boundaries](docs/research.md) for primary sources, dates, the relationship between each source and the implementation, and bounded ideas for future experiments.

## Verify and develop

Run the dependency-free model, experiment, and source checks:

```sh
npm test
npm run check
```

Install the development browser tools and run the browser smoke test:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

The browser test starts its own local server on port **4174**. It does not require a separate `npm start` session. Keep that port available.

The code uses native JavaScript modules without a build step. The main implementation boundaries are:

| File | Responsibility |
| --- | --- |
| [src/simulation.js](src/simulation.js) | Seeded model, interventions, metrics, and snapshot validation/restoration |
| [src/experiments.js](src/experiments.js) | Paired experiment protocol, input limits, and descriptive summaries |
| [src/experiment-worker.js](src/experiment-worker.js) | Background jobs, progress, cancellation, and overlap rejection |
| [index.html](index.html) and [src/styles.css](src/styles.css) | Interface structure and presentation |
| [server.js](server.js) | Local static server and asset restrictions |
| [docs/research.md](docs/research.md) | Research sources, interpretation, and model limitations |

Model and experiment tests cover deterministic replay, snapshot continuation, invalid inputs, paired settings, repeatable output, cancellation, and worker recovery. Snapshot schema and model versions are checked when loading; incompatible snapshots are rejected instead of silently reinterpreted.
