const paths = {
  habitat: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m12 8 4 2.3v4.4L12 17l-4-2.3v-4.4Z"/>',
  flask: '<path d="M9 3h6m-5 0v7L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 14h8"/><path d="M10 17h.01M14 18h.01"/>',
  book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  organism: '<ellipse cx="12" cy="13" rx="5" ry="7"/><path d="m9 6-2-3m8 3 2-3M7 10 3 8m4 6H3m5 4-4 3m13-11 4-2m-4 6h4m-5 4 4 3M12 7v12"/>',
  leaf: '<path d="M20 3c0 12-3 17-10 17a7 7 0 0 1-7-7C3 6 10 3 20 3ZM4 20 16 8"/>',
  diversity: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="10" cy="17" r="3"/><path d="m10 8 4 0m-6 2 1 4m6-4-3 5"/>',
  dna: '<path d="M7 3c0 8 10 10 10 18M17 3C17 11 7 13 7 21M8 5h8M9 8h6M9 16h6M8 19h8"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  cursor: '<path d="m4 3 6 18 3-8 8-3Z"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  play: '<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
  step: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  sliders: '<path d="M5 3v7m0 4v7M12 3v11m0 4v3M19 3v3m0 4v11M2 10h6m1 4h6m1-8h6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  rain: '<path d="M6 14a4 4 0 1 1 1-8 5 5 0 0 1 9 2 3 3 0 1 1 2 6M8 17l-1 3m6-3-1 3m6-3-1 3"/>',
  sprout: '<path d="M12 21v-8M12 13C5 14 3 10 3 5c6-1 10 2 9 8Zm0 3c0-6 3-10 9-9 0 6-3 10-9 9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  predator: '<path d="m12 3 10 17H2Z"/><path d="m8 12 2 1m6-1-2 1m-4 4h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  chart: '<path d="M3 3v18h18M6 16l4-6 4 3 6-8"/>',
  focus: '<path d="M7 3H3v4m14-4h4v4M3 17v4h4m10 0h4v-4"/><circle cx="12" cy="12" r="4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shuffle: '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c5 0 7-12 12-12h3m-4-4 4 4-4 4"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.habitat}</svg>`;
}
export function populateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
}
