/* ============================================================
   main-projects.js
   Orchestrator for projects.html — the unified library.

   Responsibilities:
     - Mount the shared top-strip (navigator dropdown).
     - Load Your projects from localStorage; render via project-card.
     - Load Examples from /examples/ (read-only from disk); render
       via project-card with the example variant.
     - Wire source-toggle, search filter, plus-card.
     - Yours actions: rename / duplicate / delete.
     - Examples actions: duplicate → editor.html?example=<slug>
       (the existing flow that copies files + meta into a new
       project in the user's library).
   ============================================================ */

import { init as initTopStrip } from './components/top-strip.js';
import { initSourceToggle, getActiveSource } from './components/source-toggle.js';
import { renderCard } from './components/project-card.js';
import { loadExamples } from './components/example-list.js';
import {
  listProjectIds,
  loadProject,
  saveProject,
  createProject,
  deleteProject,
  setActiveProjectId,
  uniqueTitle,
} from './components/project-storage.js';
import { confirm as modalConfirm } from './components/modal.js';

initTopStrip();

const yoursEl    = document.querySelector('.src-yours');
const examplesEl = document.querySelector('.src-examples');
const searchEl   = document.querySelector('.search-input');

let yoursCache    = [];   // hydrated project blobs
let examplesCache = [];   // example records

/* ---------- bootstrap ---------- */
(async function init() {
  yoursCache    = loadYoursFromStorage();
  examplesCache = await loadExamples();

  initSourceToggle({ onChange: () => applyFilter() });
  renderYours();
  renderExamples();
  applyFilter();

  searchEl?.addEventListener('input', applyFilter);
})();

/* ---------- Yours ---------- */

function loadYoursFromStorage() {
  const ids = listProjectIds();
  return ids
    .map(loadProject)
    .filter(Boolean)
    /* most-recently-updated first feels like the right default
       for a personal workspace — surfaces the project you were
       last touching without any "sort" UI. */
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function renderYours() {
  yoursEl.innerHTML = '';
  yoursEl.appendChild(plusCardElement());
  yoursCache.forEach(p => {
    yoursEl.appendChild(renderCard('yours', p, {
      onOpen:      openYours,
      onRename:    renameYours,
      onDuplicate: duplicateYours,
      onDelete:    deleteYours,
    }));
  });
  syncEmptyCaption();
}

function syncEmptyCaption() {
  const existing = yoursEl.querySelector('.empty-caption');
  if (existing) existing.remove();
  if (yoursCache.length === 0) {
    const cap = document.createElement('div');
    cap.className = 'empty-caption';
    cap.textContent = 'no projects yet — make one above';
    yoursEl.appendChild(cap);
  }
}

function plusCardElement() {
  const btn = document.createElement('button');
  btn.className = 'plus-card';
  btn.setAttribute('aria-label', 'Create new project');
  btn.innerHTML = `
    <span class="plus-card-inner">
      <span class="plus-glyph">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="0" y="0" width="24" height="24" fill="url(#plus-fill)" mask="url(#plus-mask)"/>
        </svg>
      </span>
      <span class="plus-label">New project</span>
    </span>
  `;
  btn.addEventListener('click', createNewProject);
  return btn;
}

function createNewProject() {
  /* Match the editor's first-visit bootstrap: an empty project
     with main.lua + conf.lua placeholders. The editor will hydrate
     real starter content from fixtures/welcome on first load if
     the files are blank; here we just hand off via ?project=<id>. */
  const id = createProject({
    title: uniqueTitle('untitled'),
    files: {
      'main.lua': '-- new project\n',
      'conf.lua': 'function love.conf(t)\n  t.window.width = 1280\n  t.window.height = 720\nend\n',
    },
    activeFile: 'main.lua',
  });
  if (!id) {
    console.warn('[projects] storage unavailable — could not create project');
    return;
  }
  setActiveProjectId(id);
  location.href = 'editor.html';
}

function openYours(project) {
  setActiveProjectId(project.id);
  location.href = 'editor.html';
}

function renameYours(project, nextTitle) {
  project.title = nextTitle;
  saveProject(project.id, project);
  /* Re-sort by updatedAt (saveProject stamps it) so the just-
     renamed card stays in the natural recency order. */
  yoursCache = loadYoursFromStorage();
  renderYours();
  applyFilter();
}

function duplicateYours(project) {
  const newId = createProject({
    /* Windows-style: "breakout" → "breakout (2)", "breakout (2)" →
       "breakout (3)". The trailing-paren suffix is preferred over a
       "- Copy" form so repeated duplicates of the same project don't
       turn into "breakout copy copy copy". uniqueTitle strips an
       existing " (N)" before incrementing. */
    title: uniqueTitle(project.title),
    files: { ...project.files },
    activeFile: project.activeFile,
    description: project.description,
    tags: project.tags,
    author: project.author,
    thumb: project.thumb,
  });
  if (!newId) return;
  yoursCache = loadYoursFromStorage();
  renderYours();
  applyFilter();
}

async function deleteYours(project) {
  const ok = await modalConfirm({
    title: 'Delete project?',
    message: `"${project.title}" and all its files will be removed. This can't be undone.`,
    confirmLabel: 'Delete',
    confirmVariant: 'destructive',
  });
  if (!ok) return;
  deleteProject(project.id);
  yoursCache = loadYoursFromStorage();
  renderYours();
  applyFilter();
}

/* ---------- Examples ---------- */

function renderExamples() {
  examplesEl.innerHTML = '';
  examplesCache.forEach(ex => {
    examplesEl.appendChild(renderCard('example', ex, {
      onOpen:      openExample,
      onDuplicate: openExample,
    }));
  });
}

/* Open and Duplicate are the same verb for examples: both route
   to editor.html?example=<slug>, which (in main-editor.js) copies
   the example's files + meta into a fresh project in the user's
   library. The original example stays untouched. */
function openExample(ex) {
  location.href = `editor.html?example=${encodeURIComponent(ex.slug)}`;
}

/* ---------- Search filter ----------
   Filters within the currently active source. Switching sources
   rescopes the same query (per masthead brief). */
function applyFilter() {
  const q = (searchEl?.value ?? '').trim().toLowerCase();
  const source = getActiveSource();

  if (source === 'yours') {
    filterCards(yoursEl, q, '.card', cardMatchesYours);
  } else if (source === 'examples') {
    filterCards(examplesEl, q, '.card', cardMatchesExample);
  }
}

function filterCards(container, q, selector, matcher) {
  container.querySelectorAll(selector).forEach(card => {
    const show = !q || matcher(card, q);
    card.style.display = show ? '' : 'none';
  });
}

function cardMatchesYours(card, q) {
  const id = card.dataset.projectId;
  const p = yoursCache.find(x => x.id === id);
  if (!p) return false;
  return haystack(p.title, p.description, ...(p.tags ?? [])).includes(q);
}

function cardMatchesExample(card, q) {
  const slug = card.dataset.exampleSlug;
  const ex = examplesCache.find(x => x.slug === slug);
  if (!ex) return false;
  return haystack(ex.title, ex.description, ex.author, ...(ex.tags ?? [])).includes(q);
}

function haystack(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}
