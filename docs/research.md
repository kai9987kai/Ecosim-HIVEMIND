# Research notes and model boundaries

Reviewed 9 September 2026. This is a small, CPU-based browser laboratory for exploring specified agent rules. Its measurements describe this simulation; they are not predictions about a real ecosystem. The sources below were selected for concrete design ideas, not as a systematic ranking of the field.

## Sources and their role

| Primary source | Publication date | Evidence-limited takeaway | Relationship to this app |
| --- | --- | --- | --- |
| Craig Reynolds, [Flocks, Herds, and Schools: A Distributed Behavioral Model](https://www.red3d.com/cwr/papers/1987/boids.html) | SIGGRAPH, July 1987 | Interacting agents with local perception and simple steering rules can produce aggregate flock motion. | Local movement and sensing are a useful foundation. This app is not a faithful implementation of the paper's complete motion model. |
| Nakayama et al., [Tunable pheromone interactions among microswimmers](https://doi.org/10.1073/pnas.2213713120) | PNAS, online 22 February 2023 | Physical particles following trails in a phase-change material exhibit different collective motion as interaction strength changes. | A spatial signal field makes indirect coordination inspectable. The app's pheromone deposition and decay are toy rules; the paper's experimental trails were static, and its electrokinetic physics is not implemented. |
| Faldor and Cully, [Toward Artificial Open-Ended Evolution within Lenia using Quality-Diversity](https://arxiv.org/abs/2406.04235v1) | ALife paper; arXiv 6 June 2024 | Quality-diversity search discovers varied self-organizing patterns in Lenia using explicit or learned descriptors. The authors report evidence suggestive of continued diversity, not a universal proof of open-endedness. | This motivates reporting variation alongside population size. Inherited numeric traits and mutation in this app are not Lenia, a quality-diversity archive, or evidence of open-ended evolution. |
| Kumar et al., [Automating the Search for Artificial Life with Foundation Models](https://arxiv.org/abs/2412.17799v2) | First submitted 23 December 2024; revised 16 May 2025 | ASAL uses vision-language representations to search several artificial-life substrates for targets, novelty, and diversity. | Saved experiments and visible outcomes are a foundation for future parameter search. No foundation model, semantic evaluator, automated discovery system, or ASAL reproduction is included. |
| Akhtyrchenko, Katsnelson, and Ustyuzhanin, [Directing Open-Ended Evolution in Artificial Life via Multi-Scale Path Divergence](https://arxiv.org/abs/2606.17091v2) | Preprint, 12 June 2026; revised 3 August 2026 | The authors define a multiscale trajectory statistic and report controlled comparisons on Flow-Lenia and other substrates. This is recent experimental work, not an established biological validation standard. | The transferable process is explicit observables, controlled replay, and comparison with a stated baseline. This app does not compute MSPD, expose the paper's local transition laws, or measure biological complexity. |
| Mesa team, [Batchrunner documentation, version 3.5.1](https://mesa.readthedocs.io/v3.5.1/apis/batchrunner.html) | Versioned documentation, accessed 9 September 2026 | The official agent-based modeling API supports parameter sweeps, explicit replication seeds, fixed step limits, and data collection. | These experiment-design concepts inform the app's seeded comparisons and export. The runtime is JavaScript and does not depend on Mesa. |

## Three bounded design choices

1. **Inspect indirect coordination.** Let agents deposit and sense a field; show that field separately from the agents. Here deposits occur at feeding sites and decay without diffusion. Compare otherwise identical scenarios with the coordination mechanism enabled and disabled. A signal pattern that looks organized is a hypothesis about performance, not a performance result.
2. **Make adaptation measurable.** Couple energy use and resource availability to survival and reproduction; let a small, bounded set of traits vary through inheritance and mutation. Show population, generation, and trait variation separately. Selection among programmed traits does not create new behaviors outside the model's rules.
3. **Treat changes as experiments.** Start paired scenarios from the same recorded seeds, run equal simulated durations, and retain results for each seed. Report the actual endpoint difference and its variation across replications. Preserve parameter values, model version, horizon, and intervention settings in exported results.

These are engineering choices inspired by the sources. They are deliberately much smaller than the research systems described above.

## Paired comparison protocol

The comparison module defaults to four distinct seeds derived reproducibly from the configured seed and 600 simulation ticks per arm. It also accepts an explicit list of up to 12 unique seeds and a horizon capped at 3,000 ticks. For each seed, the independent arm sets cooperation to zero; the shared arm uses the selected cooperation setting. Other starting settings match. These runs start afresh rather than continue the interactive world.

Exports retain the seeds, settings, horizon, model version, both arms' endpoint metrics, and the difference for each pair. Summaries report arithmetic arm means, the mean paired difference, and its sample standard error, `SD(paired differences) / sqrt(number of pairs)`. With one pair, the standard error is unavailable, not zero. The small default sample supports exploratory description; no significance claim or confidence interval is supplied.

## Reading experiment results

- A repeated seed is meaningful only with the same model version, configuration, update order, and simulation horizon. Rendering speed should not change the simulated time step.
- Pairing initial seeds controls the starting randomization. If births, deaths, or interventions change how a sequential random generator is consumed, later draws can diverge. Do not claim guaranteed variance reduction or identical environmental noise merely because the seed matches.
- A useful comparison reports `treatment - control` for each seed, its mean, and the number of complete pairs. Standard error describes variability in the estimated mean under the replication assumptions; it does not validate the model against nature.
- Keep interactive interventions separate from a reset-from-seed benchmark unless their timing and settings are part of the benchmark protocol. A manual resource drop changes the experiment.
- Population growth, food collection, survival, spatial pattern, and trait variation are different outcomes. None alone demonstrates intelligence, ecosystem health, or open-ended evolution.

## Follow-on experiments

An explicit behavior-descriptor archive could retain different successful regimes instead of a single winner. A future search should use one seed set for exploration and a separate, frozen set for evaluation. Automated visual scoring or MSPD would require separate implementation, compute budgeting, reproduction tests, and careful metric validation before the interface claimed either capability.
