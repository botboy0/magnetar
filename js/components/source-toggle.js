/* ============================================================
   source-toggle.js
   Wires the three Projects-page tabs (Your projects · Examples ·
   Browse) to the grid's source blocks. Browse is disabled-but-
   visible per v2 brief — clicks are no-ops.

   API:
     initSourceToggle({ onChange })
       onChange(source) — called when the active source actually
                          changes (not on no-op clicks).
     getActiveSource()  — current source key.
     setSource(source)  — programmatic switch (used by ?source=).
   ============================================================ */

const SOURCES = ['yours', 'examples', 'browse'];
const DEFAULT  = 'yours';

let active = DEFAULT;
let listeners = [];

function readURLSource() {
  const s = new URLSearchParams(location.search).get('source');
  return SOURCES.includes(s) ? s : null;
}

function writeURLSource(source) {
  const url = new URL(location.href);
  if (source === DEFAULT) url.searchParams.delete('source');
  else url.searchParams.set('source', source);
  history.replaceState({}, '', url);
}

function isDisabled(source) {
  const btn = document.querySelector(`.tab[data-source="${source}"]`);
  return btn?.getAttribute('aria-disabled') === 'true';
}

function applySource(source) {
  document.querySelectorAll('.tab').forEach(t => {
    const isActive = t.dataset.source === source;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.src').forEach(el => {
    el.style.display = (el.dataset.source === source) ? 'contents' : 'none';
  });
}

export function setSource(source) {
  if (!SOURCES.includes(source) || isDisabled(source)) return;
  if (source === active) return;
  active = source;
  applySource(source);
  writeURLSource(source);
  listeners.forEach(fn => fn(source));
}

export function getActiveSource() {
  return active;
}

export function initSourceToggle({ onChange } = {}) {
  if (onChange) listeners.push(onChange);

  const initial = readURLSource() ?? DEFAULT;
  active = initial;
  applySource(initial);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.source;
      if (!next || isDisabled(next)) return;
      setSource(next);
    });
  });
}
