import { Simulation, PRESETS, MODEL_VERSION } from './simulation.js';
import { HabitatRenderer } from './renderer.js';
import { icon, populateIcons } from './icons.js';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const titleCase = value => value.charAt(0).toUpperCase() + value.slice(1);
const signed = (value, decimals = 1) => `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
const TICK_MS = 1000 / 30;
const state = { sim: new Simulation(), playing: !matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 1, layer: 'organisms', selectedId: null, view: 'habitat', result: null, worker: null, jobId: null, jobNumber: 0 };
let accumulator = 0;
let lastTime = performance.now();
let lastUI = 0;
let manualClock = false;
let toastTimer;
let optionSignature = '';
let lastDrawTick = -1;
let lastDrawSim = null;
populateIcons();
const renderer = new HabitatRenderer($('world-canvas'));

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 4200);
}

function setPlaying(value) {
  state.playing = value;
  accumulator = 0;
  lastTime = performance.now();
  $('play-button').innerHTML = icon(value ? 'pause' : 'play');
  $('play-button').setAttribute('aria-label', value ? 'Pause simulation' : 'Resume simulation');
  $('run-status').textContent = value ? 'LIVE' : 'PAUSED';
  $('world-status-dot').classList.toggle('paused', !value);
}

function updateSettings() {
  const config = state.sim.config;
  $('preset-select').value = config.preset;
  $('new-preset').value = config.preset;
  $('preset-description').textContent = PRESETS[config.preset].description;
  $('habitat-name').textContent = PRESETS[config.preset].name;
  $('current-seed').textContent = config.seed;
  $('current-seed').title = config.seed;
  for (const [id, key, format] of [
    ['resource-rate', 'resourceRate', v => `${v.toFixed(2).replace(/0$/, '')}×`],
    ['seasonality', 'seasonality', v => `${Math.round(v * 100)}%`],
    ['cooperation', 'cooperation', v => `${Math.round(v * 100)}%`],
    ['mutation-rate', 'mutationRate', v => `${Math.round(v * 100)}%`],
  ]) {
    $(id).value = config[key];
    $(`${id}-value`).textContent = format(config[key]);
  }
  $('experiment-signal-label').textContent = `Shared signals at ${Math.round(config.cooperation * 100)}%`;
  $('experiment-context').textContent = `${PRESETS[config.preset].name} · seed ${config.seed}. Uses current behavior settings; starts new worlds without your interactive interventions.`;
}

function startWorld(config) {
  state.sim = new Simulation(config);
  state.selectedId = null;
  optionSignature = '';
  accumulator = 0;
  updateSettings();
  setPlaying(true);
  updateUI();
  draw();
}

function sparkline(element, values) {
  if (!values.length) return;
  const min = Math.min(...values), max = Math.max(...values);
  const points = values.map((value, i) => `${(i / Math.max(1, values.length - 1) * 100 + 2).toFixed(1)},${(31 - (value - min) / Math.max(1, max - min) * 26).toFixed(1)}`);
  if (points.length === 1) points.push(`102,${points[0].split(',')[1]}`);
  element.innerHTML = `<polygon points="2,35 ${points.join(' ')} 102,35" fill="currentColor" opacity=".09"/><polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
}

function populationChart() {
  const history = state.sim.history;
  const max = Math.max(20, ...history.map(row => Math.max(row.foragers, row.predators)));
  const maxY = Math.ceil(max / 20) * 20;
  const left = 30, top = 7, w = 580, h = 99;
  let svg = '';
  for (let i = 0; i <= 3; i++) {
    const y = top + h * i / 3;
    svg += `<line x1="${left}" x2="610" y1="${y}" y2="${y}" stroke="#e9eddf" stroke-dasharray="3 5"/><text x="20" y="${y + 3}" text-anchor="end" fill="#a1ac93" font-family="Consolas,monospace" font-size="8">${Math.round(maxY * (1 - i / 3))}</text>`;
  }
  const first = history[0]?.tick ?? 0, last = history.at(-1)?.tick ?? 0;
  if (history.length > 1) {
    for (const [key, color] of [['foragers', '#79966c'], ['predators', '#c6a274']]) {
      const points = history.map(row => `${left + (row.tick - first) / Math.max(1, last - first) * w},${top + h - row[key] / maxY * h}`);
      if (key === 'foragers') svg += `<polygon points="${left},${top + h} ${points.join(' ')} 610,${top + h}" fill="#87a46e" opacity=".06"/>`;
      svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
    }
  }
  for (let i = 0; i < 5; i++) svg += `<text x="${left + w * i / 4}" y="126" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" fill="#a4ae97" font-family="Consolas,monospace" font-size="8">${Math.round(first + (last - first) * i / 4)}</text>`;
  $('population-chart').innerHTML = svg;
  $('chart-range').textContent = history.length > 1 ? `${first.toLocaleString()}–${last.toLocaleString()} ticks` : 'Waiting for observations';
}

function updateObserver() {
  const selected = state.sim.agents.find(agent => agent.id === state.selectedId);
  if (state.selectedId !== null && !selected) {
    $('observer-tag').textContent = 'LIFE ENDED';
    $('observer-content').innerHTML = '<div class="observer-placeholder"><span>' + icon('leaf') + '</span><div><strong>This organism’s story has ended.</strong><p>Its life is part of the habitat’s continuing cycle. Select another to keep observing.</p></div></div>';
    $('world-hint').textContent = 'Life continues. Select another organism to observe.';
  } else if (selected) {
    $('observer-tag').textContent = `GEN ${selected.generation}`;
    $('observer-content').innerHTML = `<div class="agent-heading"><strong>${titleCase(selected.species)} #${selected.id}</strong><span>${Math.round(selected.age)} ticks old</span></div><div class="trait-list"><div>ENERGY<strong>${selected.energy.toFixed(1)}</strong></div><div>SPEED<strong>${selected.traits.speed.toFixed(2)}</strong></div><div>SENSING<strong>${selected.traits.sense.toFixed(0)}</strong></div></div>`;
    $('world-hint').textContent = `Following ${selected.species} #${selected.id} · generation ${selected.generation}`;
  } else {
    $('observer-tag').textContent = 'EXPLORE';
    $('observer-content').innerHTML = '<div class="observer-placeholder"><span>' + icon('organism') + '</span><div><strong>Every organism has a story.</strong><p>Select one to explore its energy, inherited traits, and generation.</p></div></div>';
    $('world-hint').innerHTML = icon('cursor') + 'Click an organism to follow its story';
  }
  const signature = state.sim.agents.map(agent => agent.id).join(',');
  if (signature !== optionSignature && document.activeElement !== $('organism-select')) {
    $('organism-select').innerHTML = '<option value="">Choose an organism to inspect</option>' + state.sim.agents.map(agent => `<option value="${agent.id}">${titleCase(agent.species)} #${agent.id} · generation ${agent.generation}</option>`).join('');
    optionSignature = signature;
  }
  if (document.activeElement !== $('organism-select')) $('organism-select').value = selected ? String(selected.id) : '';
}

function updateUI() {
  const metrics = state.sim.metrics();
  $('metric-population').textContent = metrics.population;
  $('metric-resources').textContent = metrics.plants;
  $('metric-diversity').textContent = metrics.diversity.toFixed(2);
  $('metric-generation').textContent = metrics.generation;
  $('population-detail').textContent = `${metrics.foragers} foragers · ${metrics.predators} predators`;
  const foodCapacity = state.sim.resources.reduce((sum, patch) => sum + patch.amount, 0) / state.sim.resources.length;
  $('resource-detail').textContent = `${Math.round(foodCapacity * 100)}% of food capacity`;
  $('world-season').textContent = titleCase(metrics.season);
  $('tick-counter').textContent = String(metrics.tick).padStart(5, '0');
  const samples = state.sim.history.slice(-45);
  for (const [id, key] of [['population', 'population'], ['resources', 'plants'], ['diversity', 'diversity'], ['generation', 'generation']]) sparkline($(`spark-${id}`), samples.map(row => row[key]));
  populationChart();
  updateObserver();
  $('latest-event').textContent = state.sim.events.at(-1)?.message || 'A new ecosystem is taking root.';
}

function draw() {
  if (state.view === 'habitat') {
    renderer.render(state.sim, { layer: state.layer, selectedId: state.selectedId });
    lastDrawTick = state.sim.tick;
    lastDrawSim = state.sim;
  }
}
function advance(ms) {
  if (state.playing && state.view === 'habitat' && !document.querySelector('dialog[open]')) {
    accumulator += ms * state.speed;
    const steps = Math.floor((accumulator + 1e-8) / TICK_MS);
    if (steps > 0) {
      state.sim.step(steps);
      accumulator = Math.max(0, accumulator - steps * TICK_MS);
    }
  }
}
function frame(now) {
  if (!manualClock && !document.hidden) advance(Math.min(100, Math.max(0, now - lastTime)));
  lastTime = now;
  if (lastDrawSim !== state.sim || lastDrawTick !== state.sim.tick) draw();
  if (now - lastUI > 250 && state.view === 'habitat') { updateUI(); lastUI = now; }
  requestAnimationFrame(frame);
}

function setView(view) {
  if (!['habitat', 'experiments', 'research'].includes(view)) return;
  if (view !== 'habitat') setPlaying(false);
  state.view = view;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.querySelectorAll('.view').forEach(element => { element.hidden = element.id !== `${view}-view`; });
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const names = { habitat: 'Habitat', experiments: 'Experiments', research: 'Research notebook' };
  $('breadcrumb').textContent = names[view];
  const titles = { habitat: 'Small agents. <span>Unexpected worlds.</span>', experiments: 'Ask a question. <span>Test it in a world.</span>', research: 'Simple rules. <span>Thoughtful foundations.</span>' };
  $('page-title').innerHTML = titles[view];
  $('page-description').textContent = { habitat: 'Create the conditions. Let life find its own way.', experiments: 'A controlled comparison, one shared seed at a time.', research: 'Research that informs the model, and the limits that keep it honest.' }[view];
  updateSettings();
  if (view === 'habitat') { updateUI(); draw(); }
}

function downloadJSON(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function finishExperiment() {
  state.jobId = null;
  $('run-experiment').hidden = false;
  $('cancel-experiment').hidden = true;
  $('cancel-experiment').disabled = false;
  $('experiment-progress').hidden = true;
}

function renderExperiment(result) {
  $('experiment-empty').hidden = true;
  $('experiment-result-content').hidden = false;
  $('export-experiment').hidden = false;
  const summary = result.summary;
  let html = '<div class="result-summary">';
  for (const [key, label, decimals] of [['foragers', 'FORAGER DIFFERENCE', 1], ['population', 'POPULATION DIFFERENCE', 1], ['diversity', 'DIVERSITY DIFFERENCE', 3]]) {
    const item = summary[key];
    html += `<div class="result-stat"><label>${label}</label><strong>${signed(item.meanDelta, decimals)}</strong><span>SE ${item.standardError === null ? 'unavailable' : item.standardError.toFixed(decimals)} · collective − independent</span></div>`;
  }
  html += `</div><p class="result-conclusion">${escapeHTML(result.conclusion)}</p><p class="table-scroll-hint">Scroll the table sideways to see every column →</p><div class="results-table-wrap" role="region" tabindex="0" aria-label="Paired results. Scroll horizontally for all columns."><table class="results-table"><thead><tr><th>Paired seed</th><th>Independent</th><th>Collective</th><th>Difference</th></tr></thead><tbody>`;
  for (const row of result.rows) html += `<tr><td title="${escapeHTML(row.seed)}">${escapeHTML(row.seed)}</td><td>${row.baseline.foragers}</td><td>${row.shared.foragers}</td><td>${signed(row.delta.foragers, 0)}</td></tr>`;
  html += `</tbody></table></div><p class="results-caption">Endpoint forager counts at ${result.ticks.toLocaleString()} ticks. SE is the standard error of the paired differences. Full endpoint measurements are included in the JSON export.</p><div class="experiment-provenance">${escapeHTML(PRESETS[result.config.preset].name)} · ${result.rows.length} complete pairs · shared signals ${Math.round(result.config.cooperation * 100)}%<br>Resource renewal ${result.config.resourceRate}× · mutation ${Math.round(result.config.mutationRate * 100)}% · seasonal variation ${Math.round(result.config.seasonality * 100)}%<br>Model ${escapeHTML(result.modelVersion)} · ${escapeHTML(result.createdAt)}</div>`;
  $('experiment-result-content').innerHTML = html;
}

function runExperiment() {
  if (state.jobId !== null) return;
  setPlaying(false);
  try {
    if (!state.worker) {
      state.worker = new Worker(new URL('./experiment-worker.js', import.meta.url), { type: 'module' });
      state.worker.addEventListener('message', ({ data }) => {
        if (data.id !== state.jobId) return;
        if (data.type === 'progress') {
          document.querySelector('#experiment-progress progress').value = data.progress.fraction;
          $('experiment-progress-label').textContent = `Pair ${data.progress.replicate} of ${data.progress.total} · tick ${data.progress.tick} / ${data.progress.ticks}`;
        } else if (data.type === 'result') {
          state.result = data.result; renderExperiment(data.result); finishExperiment();
          toast(`Experiment complete. ${data.result.rows.length} paired worlds observed.`);
        } else if (data.type === 'error') {
          finishExperiment(); toast(data.cancelled ? 'Experiment cancelled. Previous observations are preserved.' : data.message, !data.cancelled);
        }
      });
      state.worker.addEventListener('error', () => {
        state.worker.terminate(); state.worker = null; finishExperiment();
        toast('The experiment worker stopped. Please try again.', true);
      });
    }
    state.jobId = `experiment-${++state.jobNumber}`;
    $('run-experiment').hidden = true;
    $('cancel-experiment').hidden = false;
    $('experiment-progress').hidden = false;
    document.querySelector('#experiment-progress progress').value = 0;
    $('experiment-progress-label').textContent = 'Preparing paired worlds…';
    state.worker.postMessage({ type: 'run', id: state.jobId, options: { config: { ...state.sim.config }, replicates: Number($('replicate-count').value), ticks: Number($('experiment-ticks').value) } });
  } catch (error) { finishExperiment(); toast(error.message, true); }
}

const research = [
  ['LOCAL RULES · 1987', 'Order without an overseer', 'Reynolds showed how local interactions can create collective motion. Our agents likewise sense nearby resources and neighbors; they do not implement the full Boids model.', 'Reynolds · Distributed behavioral model', 'https://www.red3d.com/cwr/papers/1987/boids.html'],
  ['INDIRECT COORDINATION · 2023', 'Leave a trace. Find a way.', 'Physical microswimmers show tunable trail interactions. Our inspectable signal field uses simplified deposition and decay, without reproducing the material physics.', 'Nakayama et al. · PNAS', 'https://doi.org/10.1073/pnas.2213713120'],
  ['DIVERSITY · 2024', 'More than a single winner', 'Quality-diversity research in Lenia motivates looking beyond population size. Here, diversity measures the distribution of inherited forager traits.', 'Faldor & Cully · Leniabreeder', 'https://arxiv.org/abs/2406.04235v1'],
  ['AUTOMATED DISCOVERY · 2024–25', 'A search for unexpected life', 'ASAL explores artificial-life worlds with foundation models. Our lab provides saved outcomes for human exploration; automated semantic search is a future direction.', 'Kumar et al. · ASAL', 'https://arxiv.org/abs/2412.17799v2'],
  ['EXPERIMENTAL METHODS · 2026', 'Measure what you mean', 'A recent preprint explores multiscale trajectory statistics. It reinforces the value of explicit observables and controlled comparisons. This app does not calculate MSPD.', 'Akhtyrchenko et al. · MSPD preprint', 'https://arxiv.org/abs/2606.17091v2'],
  ['REPRODUCIBLE PROCESS', 'Same question. Many worlds.', 'Mesa’s official batch tools use explicit seeds and repetitions. Our paired experiments adopt that process, with fixed horizons and every seed’s result retained.', 'Mesa · Batchrunner documentation', 'https://mesa.readthedocs.io/v3.5.1/apis/batchrunner.html'],
];
$('research-cards').innerHTML = research.map(([category, title, body, label, url], i) => `<article class="research-card card"><div class="research-number">0${i + 1}<span>${category}</span></div><h3>${title}</h3><p>${body}</p><a href="${url}" target="_blank" rel="noopener">${label} ↗</a></article>`).join('');

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => {
  state.layer = button.dataset.layer;
  document.querySelectorAll('[data-layer]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  draw();
}));
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {
  state.speed = Number(button.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
}));
$('play-button').addEventListener('click', () => setPlaying(!state.playing));
$('step-button').addEventListener('click', () => { setPlaying(false); state.sim.step(); updateUI(); draw(); });
$('reset-button').addEventListener('click', () => { startWorld({ ...state.sim.config }); toast('World restarted from the same seed and current settings.'); });
for (const [id, key] of [['resource-rate', 'resourceRate'], ['seasonality', 'seasonality'], ['cooperation', 'cooperation'], ['mutation-rate', 'mutationRate']]) {
  $(id).addEventListener('input', () => {
    state.sim.updateConfig({ [key]: Number($(id).value) });
    updateSettings(); updateUI();
  });
}
$('preset-select').addEventListener('change', () => { startWorld({ ...state.sim.config, preset: $('preset-select').value }); toast(`${PRESETS[state.sim.config.preset].name} created with the current seed.`); });
document.querySelectorAll('[data-intervention]').forEach(button => button.addEventListener('click', () => {
  state.sim.intervene(button.dataset.intervention); updateUI(); draw();
  toast(state.sim.events.at(-1)?.message || 'Intervention applied.');
}));
$('world-canvas').addEventListener('click', event => {
  state.selectedId = renderer.pick(state.sim, event.clientX, event.clientY)?.id ?? null;
  updateObserver(); draw();
});
$('organism-select').addEventListener('change', () => { state.selectedId = $('organism-select').value === '' ? null : Number($('organism-select').value); updateObserver(); draw(); });
$('new-world-button').addEventListener('click', () => { $('new-seed').value = state.sim.config.seed; $('new-preset').value = state.sim.config.preset; $('new-world-dialog').showModal(); });
$('new-world-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    startWorld({ ...state.sim.config, preset: $('new-preset').value, seed: $('new-seed').value.trim() });
    $('new-world-dialog').close(); setView('habitat'); toast('Your new world is ready.');
  } catch (error) { toast(error.message, true); }
});
$('random-seed').addEventListener('click', () => { $('new-seed').value = `HIVE-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`; });
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('event-log-button').addEventListener('click', () => {
  $('event-list').innerHTML = [...state.sim.events].reverse().map(event => `<li><time>TICK ${event.tick}</time>${escapeHTML(event.message)}</li>`).join('') || '<li>No events yet.</li>';
  $('events-dialog').showModal();
});
$('save-button').addEventListener('click', () => {
  downloadJSON(state.sim.snapshot(), `ecosim-${state.sim.config.seed.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 70)}-tick-${state.sim.tick}.json`);
  toast('World snapshot saved, including its complete simulation state.');
});
$('load-button').addEventListener('click', () => $('snapshot-file').click());
$('snapshot-file').addEventListener('change', async () => {
  const file = $('snapshot-file').files[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Snapshot exceeds the 8 MB file limit.');
    const restored = Simulation.fromSnapshot(JSON.parse(await file.text()));
    state.sim = restored; state.selectedId = null; optionSignature = '';
    setPlaying(false); setView('habitat'); updateSettings(); updateUI(); draw();
    toast(`World restored at tick ${restored.tick}. Press play to continue.`);
  } catch (error) { toast(`Could not load world: ${error.message}`, true); }
  finally { $('snapshot-file').value = ''; }
});
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.world-panel').requestFullscreen();
  } catch { toast('Fullscreen is unavailable in this browser.', true); }
}
$('fullscreen-button').addEventListener('click', fullscreen);
document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,button,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (event.code === 'Space' && state.view === 'habitat') { event.preventDefault(); setPlaying(!state.playing); }
  if (event.key.toLowerCase() === 'f' && state.view === 'habitat') { event.preventDefault(); fullscreen(); }
});
document.addEventListener('visibilitychange', () => { lastTime = performance.now(); accumulator = 0; });
$('run-experiment').addEventListener('click', runExperiment);
$('cancel-experiment').addEventListener('click', () => { if (state.jobId !== null) { state.worker.postMessage({ type: 'cancel', id: state.jobId }); $('cancel-experiment').disabled = true; $('experiment-progress-label').textContent = 'Cancelling…'; } });
$('export-experiment').addEventListener('click', () => { if (state.result) downloadJSON(state.result, `ecosim-experiment-${state.result.createdAt.replace(/[:.]/g, '-')}.json`); });

// Deterministic inspection hooks for the browser development loop.
window.render_game_to_text = () => JSON.stringify({
  mode: state.view, playing: state.playing, speed: state.speed, layer: state.layer,
  coordinateSystem: 'origin top-left; x rightward 0..1000, y downward 0..680; edges wrap',
  config: state.sim.config, metrics: state.sim.metrics(), selectedId: state.selectedId,
  agents: state.sim.agents.slice(0, 20).map(({ id, species, x, y, energy, generation }) => ({ id, species, x, y, energy, generation })),
  selected: state.sim.agents.find(agent => agent.id === state.selectedId) || null,
  fieldMaximum: Math.max(...state.sim.pheromones.values),
  latestEvent: state.sim.events.at(-1), experimentRunning: state.jobId !== null,
  experimentResult: state.result ? { rows: state.result.rows.length, ticks: state.result.ticks, summary: state.result.summary, config: state.result.config } : null,
  modelVersion: MODEL_VERSION,
});
window.advanceTime = ms => {
  if (!Number.isFinite(ms) || ms < 0 || ms > 60000) throw new TypeError('Advance time must be 0..60000 milliseconds.');
  manualClock = true; advance(ms); updateUI(); draw();
};
updateSettings(); setPlaying(state.playing); updateUI(); draw();
requestAnimationFrame(frame);
