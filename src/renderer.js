import { WORLD_WIDTH, WORLD_HEIGHT } from './simulation.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const PALETTES = {
  meadow: { base: '#dce5b8', light: '#e9edcb', band: '#c6d59f', deep: '#b4c995', shore: '#d6dba4', water: '#88b6a1', waterLight: '#a6c7af', waterDeep: '#6c9f91', foliage: ['#75956c', '#89a474', '#9caf7e', '#648764'], trunk: '#738568' },
  dunes: { base: '#e6d8ab', light: '#f0e4c1', band: '#d9c592', deep: '#c6b882', shore: '#e5d6ad', water: '#92b4a0', waterLight: '#b0cbb2', waterDeep: '#7ba08c', foliage: ['#92986a', '#a8a775', '#bcc08e', '#808c61'], trunk: '#95876b' },
  wetlands: { base: '#d4e4c5', light: '#e3edcf', band: '#bbd5b6', deep: '#a1c6a7', shore: '#cddbb2', water: '#8bbdb0', waterLight: '#abd3bd', waterDeep: '#71a799', foliage: ['#6b9878', '#83ab89', '#99bb92', '#59886f'], trunk: '#6b8970' },
};

// This independent stream decorates the map without consuming simulation randomness.
function visualRandom(seed) {
  let state = 2166136261;
  for (const character of `habitat-art:${seed}`) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function surface(width, height) {
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  return canvas;
}

function ellipse(ctx, x, y, rx, ry, color, angle = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function tree(ctx, x, y, radius, palette, rng) {
  ellipse(ctx, x + radius * 0.42, y + radius * 0.7, radius * 1.16, radius * 0.59, '#52764a18', -0.2);
  ctx.strokeStyle = palette.trunk;
  ctx.lineWidth = Math.max(0.7, radius * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y + radius);
  ctx.lineTo(x, y - radius * 0.15);
  ctx.stroke();
  const lobes = 4 + Math.floor(rng() * 3);
  for (let lobe = 0; lobe < lobes; lobe++) {
    const angle = lobe / lobes * TAU;
    const dx = Math.cos(angle) * radius * 0.36;
    const dy = Math.sin(angle) * radius * 0.29;
    ellipse(ctx, x + dx, y + dy, radius * (0.54 + rng() * 0.16), radius * (0.52 + rng() * 0.15), palette.foliage[lobe % palette.foliage.length]);
  }
  ellipse(ctx, x - radius * 0.2, y - radius * 0.27, radius * 0.44, radius * 0.3, '#dbe7b645', -0.25);
  ctx.strokeStyle = '#43684630';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y + radius * 0.48);
  ctx.lineTo(x - radius * 0.15, y - radius * 0.15);
  ctx.moveTo(x - radius * 0.04, y + radius * 0.1);
  ctx.lineTo(x + radius * 0.35, y - radius * 0.17);
  ctx.stroke();
}

/** Decorative terrain has no effect on the toroidal simulation's movement rules. */
export class HabitatRenderer {
  constructor(canvas) {
    if (!canvas?.getContext) throw new TypeError('A canvas is required.');
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('Canvas 2D is unavailable.');
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this._background = null;
    this._backgroundKey = '';
    this._fieldCanvas = null;
    this._lastSim = null;
    this._lastOptions = {};
    this.resize();
    if (typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(() => {
        if (this.resize() && this._lastSim) this.render(this._lastSim, this._lastOptions);
      });
      this._observer.observe(canvas);
    }
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return false;
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 2);
    const width = bounds.width;
    const height = bounds.height;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (width === this.width && height === this.height && dpr === this.dpr && this.canvas.width === pixelWidth && this.canvas.height === pixelHeight) return false;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this._background = null;
    return true;
  }

  _makeBackground(sim) {
    const key = `${sim.config.seed}|${sim.config.preset}|${this.canvas.width}|${this.canvas.height}`;
    if (this._background && key === this._backgroundKey) return;
    const background = surface(this.canvas.width, this.canvas.height);
    const ctx = background.getContext('2d');
    ctx.setTransform(background.width / WORLD_WIDTH, 0, 0, background.height / WORLD_HEIGHT, 0, 0);
    const palette = PALETTES[sim.config.preset] || PALETTES.meadow;
    const rng = visualRandom(`${sim.config.seed}:${sim.config.preset}`);
    const shift = (rng() - 0.5) * 60;
    ctx.fillStyle = palette.base;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Broad, soft-edged contours keep the small living details easy to read.
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.moveTo(-40, -40); ctx.lineTo(770, -40);
    ctx.bezierCurveTo(620, 70, 455, 15, 365, 180);
    ctx.bezierCurveTo(290, 325, 80, 220, -40, 385);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = palette.band;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(-40, 430);
    ctx.bezierCurveTo(120, 330, 180, 480, 325, 400);
    ctx.bezierCurveTo(520, 300, 640, 585, 1050, 420);
    ctx.lineTo(1050, 740); ctx.lineTo(-40, 740); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.deep;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.moveTo(880, -50);
    ctx.bezierCurveTo(750, 160, 780, 210, 1090, 375);
    ctx.lineTo(1080, -50); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    for (let band = 0; band < 9; band++) {
      ctx.strokeStyle = band % 2 ? '#fcffe921' : '#7793600b';
      ctx.lineWidth = 1.2;
      const y = 105 + band * 78;
      ctx.beginPath(); ctx.moveTo(-80, y);
      ctx.bezierCurveTo(100, y - 145, 310, y + 20, 460, y - 145);
      ctx.bezierCurveTo(655, y - 290, 840, y - 90, 1090, y - 190);
      ctx.stroke();
    }

    const river = new Path2D();
    river.moveTo(737 + shift, -100);
    river.bezierCurveTo(690 + shift, 58, 832 + shift, 150, 692 + shift, 235);
    river.bezierCurveTo(607 + shift, 285, 588 + shift, 314, 642 + shift, 385);
    river.bezierCurveTo(715 + shift, 481, 465 + shift, 435, 422 + shift, 568);
    river.bezierCurveTo(396 + shift, 660, 510 + shift, 690, 493 + shift, 780);
    ctx.lineCap = 'round';
    const riverWidth = sim.config.preset === 'wetlands' ? 105 : sim.config.preset === 'dunes' ? 53 : 83;
    for (const [width, color] of [[riverWidth + 36, palette.light], [riverWidth + 22, palette.shore], [riverWidth + 5, palette.waterLight], [riverWidth, palette.water], [riverWidth - 19, `${palette.waterDeep}36`]]) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke(river);
    }
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#e1f0cf50';
    ctx.stroke(river);

    // Ripple marks are clipped to the decorative water channel.
    const waterMask = surface(1000, 680);
    const maskCtx = waterMask.getContext('2d');
    maskCtx.lineWidth = Math.max(8, riverWidth - 17);
    maskCtx.lineCap = 'round';
    maskCtx.stroke(river);
    const mask = maskCtx.getImageData(0, 0, 1000, 680).data;
    for (let ripple = 0; ripple < 170; ripple++) {
      const x = Math.floor(rng() * WORLD_WIDTH);
      const y = Math.floor(rng() * WORLD_HEIGHT);
      if (!mask[(y * 1000 + x) * 4 + 3]) continue;
      ctx.strokeStyle = '#e6f1d850';
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x - 4, y);
      ctx.quadraticCurveTo(x, y + 1.5, x + 5 + rng() * 9, y - 1);
      ctx.stroke();
    }

    // Decorative vegetation is clustered, leaving generous open meadow.
    const clusters = [
      [98, 202, 65, 52], [225, 166, 77, 44], [140, 492, 98, 70],
      [345, 400, 66, 49], [916, 328, 102, 66], [812, 561, 110, 61],
      [580, 95, 45, 40], [290, 632, 46, 32],
    ];
    const trees = [];
    for (const [cx, cy, spreadX, spreadY] of clusters) {
      const density = sim.config.preset === 'dunes' ? 7 : sim.config.preset === 'wetlands' ? 21 : 17;
      for (let i = 0; i < density; i++) {
        const angle = rng() * TAU;
        const distance = Math.sqrt(rng());
        const x = clamp(cx + Math.cos(angle) * distance * spreadX + (rng() - 0.5) * 30, 7, 993);
        const y = clamp(cy + Math.sin(angle) * distance * spreadY + (rng() - 0.5) * 25, 8, 672);
        if (mask[(Math.floor(y) * 1000 + Math.floor(x)) * 4 + 3]) continue;
        trees.push({ x, y, radius: 4.5 + rng() * 5.9 });
      }
    }
    trees.sort((a, b) => a.y - b.y);
    for (const item of trees) tree(ctx, item.x, item.y, item.radius, palette, rng);

    for (let mark = 0; mark < 1600; mark++) {
      const x = Math.floor(rng() * WORLD_WIDTH);
      const y = Math.floor(rng() * WORLD_HEIGHT);
      if (mask[(y * 1000 + x) * 4 + 3]) continue;
      const size = 0.35 + rng() * 0.9;
      ellipse(ctx, x, y, size, size * 0.66, rng() > 0.46 ? '#62835226' : '#ffffe547');
      if (mark % 11 === 0) {
        ctx.strokeStyle = '#688b4929'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x - 1.6, y - 1); ctx.lineTo(x, y + 2); ctx.lineTo(x + 1.8, y - 1.5); ctx.stroke();
      }
    }

    const wash = ctx.createLinearGradient(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    wash.addColorStop(0, '#fffce821'); wash.addColorStop(0.55, '#ffffff00'); wash.addColorStop(1, '#5d84540b');
    ctx.fillStyle = wash; ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this._background = background;
    this._backgroundKey = key;
  }

  _drawField(sim) {
    const { cols, rows, values } = sim.pheromones;
    if (!this._fieldCanvas || this._fieldCanvas.width !== cols || this._fieldCanvas.height !== rows) this._fieldCanvas = surface(cols, rows);
    const fieldContext = this._fieldCanvas.getContext('2d');
    const pixels = fieldContext.createImageData(cols, rows);
    for (let index = 0; index < values.length; index++) {
      const strength = Math.sqrt(clamp(values[index], 0, 10) / 10);
      pixels.data[index * 4] = Math.round(101 + strength * 36);
      pixels.data[index * 4 + 1] = Math.round(158 + strength * 18);
      pixels.data[index * 4 + 2] = Math.round(56 - strength * 9);
      pixels.data[index * 4 + 3] = Math.round(strength * 230);
    }
    fieldContext.putImageData(pixels, 0, 0);
    const ctx = this.context;
    ctx.fillStyle = '#f4f6e492'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._fieldCanvas, 0, 0, this.width, this.height);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#516748';
    ctx.fillText('SIGNAL  0–10 · square-root display scale', 15, this.height - 12);
  }

  render(sim, { layer = 'organisms', selectedId = null } = {}) {
    this._lastSim = sim;
    this._lastOptions = { layer, selectedId };
    this.resize();
    this._makeBackground(sim);
    const ctx = this.context;
    // Draw in CSS pixels; map coordinates and the picking transform are identical.
    ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this._background, 0, 0, this.width, this.height);
    const signalLayer = layer === 'signals' || layer === 'signal' || layer === 'pheromones';
    const resourceLayer = layer === 'resources';
    if (signalLayer) this._drawField(sim);
    const sx = this.width / WORLD_WIDTH;
    const sy = this.height / WORLD_HEIGHT;
    const markerScale = clamp(Math.sqrt(sx * sy), 0.8, 1.18);

    for (const food of sim.resources) {
      if (food.amount < 0.015) continue;
      const x = food.x * sx;
      const y = food.y * sy;
      const richness = clamp(food.amount, 0, 1);
      const size = (1.3 + richness * 2.3) * markerScale;
      ctx.globalAlpha = signalLayer ? 0.22 : 0.28 + richness * 0.65;
      if (resourceLayer) {
        ellipse(ctx, x, y, size * 3.2, size * 3.2, '#b9c75a35');
        ellipse(ctx, x, y, size * 1.65, size * 1.65, '#afb94052');
      }
      ctx.strokeStyle = '#819a4b'; ctx.lineWidth = 0.65 * markerScale;
      ctx.beginPath(); ctx.moveTo(x, y + size * 0.6); ctx.lineTo(x, y - size * 0.55); ctx.stroke();
      ellipse(ctx, x - size * 0.46, y - size * 0.1, size * 0.66, size * 0.34, '#a4b64d', 0.5);
      ellipse(ctx, x + size * 0.38, y - size * 0.53, size * 0.62, size * 0.34, '#b7c55b', -0.55);
      ellipse(ctx, x + size * 0.12, y - size * 0.76, size * 0.21, size * 0.21, '#e0d789');
    }

    for (const agent of sim.agents) {
      const x = agent.x * sx;
      const y = agent.y * sy;
      const selected = agent.id === selectedId;
      const predator = agent.species === 'predator';
      ctx.globalAlpha = selected ? 1 : resourceLayer ? 0.28 : signalLayer ? 0.77 : 0.95;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(Math.sin(agent.angle) * sy, Math.cos(agent.angle) * sx));
      ctx.scale(markerScale, markerScale);
      if (predator) {
        ellipse(ctx, -0.7, 1.4, 6.1, 3.9, '#64422b16');
        ctx.fillStyle = '#cc9560'; ctx.strokeStyle = '#9d7049'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(6.2, 0); ctx.lineTo(-4.2, -3.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-4.2, 3.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#edc78b'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-1.6, -1.4); ctx.lineTo(3.4, -0.3); ctx.stroke();
        ellipse(ctx, 3.15, -0.72, 0.5, 0.5, '#725d3f');
      } else {
        const tone = clamp((agent.energy - 15) / 110, 0, 1);
        ctx.strokeStyle = '#4a6f4b'; ctx.lineWidth = 0.65;
        ctx.beginPath();
        for (let leg = -1; leg <= 1; leg++) {
          ctx.moveTo(leg * 1.55 - 1, -1.6); ctx.lineTo(leg * 1.8 - 1.7, -3.15);
          ctx.moveTo(leg * 1.55 - 1, 1.6); ctx.lineTo(leg * 1.8 - 1.7, 3.15);
        }
        ctx.stroke();
        ellipse(ctx, -0.9, 0, 3.55, 2.28, tone > 0.4 ? '#60895c' : '#8b9c65');
        ctx.beginPath(); ctx.ellipse(-0.9, 0, 3.55, 2.28, 0, 0, TAU); ctx.stroke();
        ellipse(ctx, 2.45, 0, 1.7, 1.65, '#527d51');
        ellipse(ctx, -1.4, -0.7, 1.95, 0.65, '#d5e3a44f');
        ctx.strokeStyle = '#d7e3a987'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(-3.1, 0); ctx.lineTo(0.9, 0); ctx.stroke();
        ellipse(ctx, 3.1, -0.73, 0.4, 0.4, '#e9efcc');
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    const selected = sim.agents.find(agent => agent.id === selectedId);
    if (selected) {
      const x = selected.x * sx;
      const y = selected.y * sy;
      const radius = selected.traits.sense;
      ctx.fillStyle = '#f7f9d916'; ctx.strokeStyle = '#4b765566'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.ellipse(x, y, radius * sx, radius * sy, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#f8f8e9'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.arc(x, y, 10.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#3d714f'; ctx.lineWidth = 1.3; ctx.stroke();
    }
  }

  pick(sim, clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1 || clientX < bounds.left || clientY < bounds.top || clientX > bounds.right || clientY > bounds.bottom) return null;
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    let nearest = null;
    let shortest = 18 * 18;
    for (const agent of sim.agents) {
      const dx = agent.x / WORLD_WIDTH * bounds.width - x;
      const dy = agent.y / WORLD_HEIGHT * bounds.height - y;
      const distance = dx * dx + dy * dy;
      if (distance <= shortest) { nearest = agent; shortest = distance; }
    }
    return nearest;
  }

  destroy() {
    this._observer?.disconnect();
    this._lastSim = null;
    this._background = null;
    this._fieldCanvas = null;
  }
}
