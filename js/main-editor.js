/* ============================================================
   main-editor.js
   Orchestrator for editor.html.
   c2 initializes the shared top strip.
   c3 adds click-log stubs for dock icons and the Fork button.
       (No panel opening — v3 feature. Run stays unwired — c5.)
   c4a — Monaco remount via editor-mount.js.
   c4b — multi-project localStorage persistence + autosave.
   c4c — project-title pen rename (topstrip + status-line sync).
   c4d1 — models registry + file-dropdown switch-only.
   c4d2 — delete file (modal primitive + trash icon).
   c4d3 — add file, rename file, inline validation.
   c5b1 — Run button wiring: payload assembly + iframe boot.
   c5b2 will add Ctrl+Enter and multi-file verification.
   c5c will wire status badge handling.
   ============================================================ */

import { init as initTopStrip } from './components/top-strip.js';
import { initEditor, getModel, disposeModel, createModel, renameModel } from './components/editor-mount.js';
import {
  getActiveProjectId,
  setActiveProjectId,
  loadProject,
  saveProject,
  createProject,
  debounce,
} from './components/project-storage.js';
import { initProjectRename } from './components/project-rename.js';
import { initFileDropdown, refresh as refreshFileDropdown } from './components/file-dropdown.js';

initTopStrip();

/* ---------- project bootstrap ----------
   Resolve which project to open, creating a starter one if
   this is the user's first visit or their stored project is
   gone/corrupted. Returns the hydrated project object. */
async function bootstrapProject() {
  const existingId = getActiveProjectId();
  if (existingId) {
    const existing = loadProject(existingId);
    if (existing) return existing;
    /* Pointer exists but blob is missing/corrupt. Clear and
       fall through to create a fresh starter project. */
    setActiveProjectId(null);
  }

  /* First visit (or recovered-from-corruption): seed a new
     project with main.lua as the starter (entry-point) file
     and conf.lua to set the default 1280×720 (16:9) window.
     Love2D runs main.lua as its entry point, and Magnetar
     inherits that convention; a project without main.lua is
     not runnable. Seeding both on creation means fresh projects
     work out of the box at the expected canvas size.

     Canvas dimensions are project-controlled (via conf.lua),
     not editor-controlled — the runner respects whatever
     Love2D picks. See PROTOCOL.md.

     If a fetch fails we still create the project, just with a
     one-line comment in place of the missing file — better than
     refusing to boot. A missing conf.lua is non-fatal: Love2D
     falls back to its own defaults (800×600). */
  let starterCode = '-- could not load starter\n';
  let confCode = '-- could not load default conf\n';
  try {
    const res = await fetch('fixtures/main.lua');
    if (res.ok) starterCode = await res.text();
  } catch (e) {
    console.warn('[editor] failed to load starter fixture:', e);
  }
  try {
    const res = await fetch('fixtures/conf.lua');
    if (res.ok) confCode = await res.text();
  } catch (e) {
    console.warn('[editor] failed to load default conf:', e);
  }

  const newId = createProject({
    title: 'untitled',
    files: {
      'main.lua': starterCode,
      'conf.lua': confCode,
    },
    activeFile: 'main.lua',
  });

  if (!newId) {
    /* Storage is so broken we can't even create. Hand back an
       in-memory project; changes won't persist but the editor
       still works for the session. */
    console.warn('[editor] storage unavailable — running in-memory only');
    return {
      id: null,
      title: 'untitled',
      files: {
        'main.lua': starterCode,
        'conf.lua': confCode,
      },
      activeFile: 'main.lua',
    };
  }

  setActiveProjectId(newId);
  return loadProject(newId);
}

/* ---------- Monaco mount + autosave ---------- */
(async () => {
  const mount = document.getElementById('editor-panel');
  if (!mount) return;

  const project = await bootstrapProject();

  let editor;
  try {
    editor = await initEditor(mount, {
      files: project.files,
      activeFile: project.activeFile,
    });
  } catch (e) {
    console.error('[editor] Monaco mount failed:', e);
    return;
  }

  /* Autosave: the editor's onChange fires for whatever model
     is currently attached. The handler reads project.activeFile
     at call time, so it tracks file switches without any
     per-model listener bookkeeping. Debounced 300ms — lands
     between "responsive enough the user trusts their changes
     stuck" and "quiet enough that typing doesn't hammer disk". */
  const persist = debounce(() => {
    if (!project.id) return; /* in-memory fallback: nothing to save */
    const name = project.activeFile;
    const model = getModel(name);
    if (!model) return;
    project.files[name] = model.getValue();
    saveProject(project.id, project);
  }, 300);

  editor.onDidChangeModelContent(persist);

  /* Project-title rename. Display surfaces (topstrip, status-line,
     preview-stage) listen for project:titlechange and update
     themselves; project-rename.js dispatches the event on the
     initial seed and on every commit/revert. Adding a fourth
     surface (e.g. project list) is one more listener here.

     Listeners are attached BEFORE initProjectRename runs so the
     seed dispatch lands. Missing-element checks are silent: if a
     surface isn't in the DOM, that surface just doesn't update. */
  const titleSurfaces = [
    document.querySelector('.topstrip .project-title'),
    document.querySelector('.status-line .meta-title'),
    document.querySelector('.preview-stage .preview-title-name'),
  ].filter(Boolean);

  document.addEventListener('project:titlechange', (e) => {
    const title = e.detail?.title;
    if (typeof title !== 'string') return;
    for (const el of titleSurfaces) {
      el.textContent = title;
    }
  });

  /* Commit writes project.title and persists immediately (not
     debounced — rename is a discrete action, not a stream of
     keystrokes). */
  initProjectRename(project, {
    onCommit: () => {
      if (!project.id) return;
      saveProject(project.id, project);
    },
  });

  /* File dropdown — full c4d scope: switch, delete, add, rename.
     All handlers follow the same pattern: update project state,
     update the runtime models, persist, refresh the dropdown. */
  initFileDropdown(project, {
    onSwitch: (filename) => {
      const model = getModel(filename);
      if (!model) {
        console.warn(`[editor] no model for ${filename}`);
        return;
      }
      editor.setModel(model);
      project.activeFile = filename;
      if (project.id) saveProject(project.id, project);
      refreshFileDropdown();
      editor.focus();
    },

    onDelete: (filename) => {
      /* Guard: main.lua is the protected entry point and cannot
         be deleted. The UI already omits the trash icon for it,
         so this path shouldn't be reachable — the check is
         defence-in-depth in case a caller (or a future code
         path) slips past the UI. */
      if (filename === 'main.lua') {
        console.warn('[editor] refusing to delete protected entry point');
        return;
      }
      if (!(filename in project.files)) return;

      /* If we're deleting the active file, pick a replacement
         before we tear anything down. Alphabetical next-available,
         excluding the file being deleted. main.lua always exists
         so this set is never empty. */
      const wasActive = project.activeFile === filename;
      if (wasActive) {
        const remaining = Object.keys(project.files)
          .filter(n => n !== filename)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const next = remaining[0];
        const nextModel = getModel(next);
        if (nextModel) {
          editor.setModel(nextModel);
          project.activeFile = next;
        }
      }

      delete project.files[filename];
      disposeModel(filename);

      if (project.id) saveProject(project.id, project);
      refreshFileDropdown();
      if (wasActive) editor.focus();
    },

    onAdd: (filename) => {
      /* The validator in file-dropdown.js already ensured the
         filename is unique and well-formed. This handler just
         wires storage + model creation + UI update. New files
         become the active file immediately so the user can
         start editing without a second click. */
      if (filename in project.files) {
        console.warn(`[editor] onAdd called with existing filename: ${filename}`);
        return;
      }
      project.files[filename] = '';
      createModel(filename, '');
      const model = getModel(filename);
      if (model) {
        editor.setModel(model);
        project.activeFile = filename;
      }
      if (project.id) saveProject(project.id, project);
      refreshFileDropdown();
      editor.focus();
    },

    onRename: (oldName, newName) => {
      /* Guard: main.lua is protected from rename. Same
         defence-in-depth pattern as onDelete. */
      if (oldName === 'main.lua') {
        console.warn('[editor] refusing to rename protected entry point');
        return;
      }
      if (!(oldName in project.files) || newName in project.files) return;

      /* Transfer content under the new key; drop the old.
         Object key reinsertion preserves the content but loses
         the original insertion position — which is fine because
         the dropdown sorts alphabetically at render time. */
      project.files[newName] = project.files[oldName];
      delete project.files[oldName];

      /* Model lifecycle during rename (order matters):
         1. renameModel creates `fresh` under the new name.
            It does NOT dispose the old model — disposing a
            model currently attached to the editor is undefined
            behavior.
         2. If the editor was pointed at the old model, setModel
            to `fresh` FIRST so the editor is no longer using
            the old one.
         3. Only then disposeModel(oldName) — safe now.
         Rename loses per-file undo history (accepted trade-off;
         see d1 design discussion). */
      renameModel(oldName, newName);
      if (project.activeFile === oldName) {
        const fresh = getModel(newName);
        if (fresh) editor.setModel(fresh);
        project.activeFile = newName;
      }
      disposeModel(oldName);

      if (project.id) saveProject(project.id, project);
      refreshFileDropdown();
      editor.focus();
    },
  });

  /* ---------- Run wiring (c5b1) ----------
     Builds a v1 payload from the live Monaco models, writes it to
     sessionStorage, and points the runtime iframe at runner.html.
     Cache-bust query param forces a fresh boot every Run — Love.js
     re-initializes from scratch each iframe load.

     Reads model values, NOT project.files: autosave is debounced
     300ms, so a fast-click Run could otherwise see stale content.
     Models are current on every keystroke. (See PROTOCOL.md.) */
  const previewStage = document.querySelector('.preview-stage');
  const previewFrame = document.querySelector('.preview-frame');
  const playBtn = document.getElementById('play');

  function runProject() {
    if (!previewFrame) {
      console.warn('[run] no preview-frame element; aborting');
      return;
    }

    const files = {};
    for (const name of Object.keys(project.files)) {
      const model = getModel(name);
      if (!model) {
        /* Defensive: every file in the registry should have a
           model. If one's missing, skip with a warning rather
           than failing the whole Run. The runner will surface
           "Entry file not found" if main.lua is the casualty. */
        console.warn(`[run] no model for ${name}; skipping`);
        continue;
      }
      files[name] = model.getValue();
    }

    const payload = {
      version: 1,
      files,
      entry: 'main.lua',
    };

    try {
      sessionStorage.setItem('magnetar.runtime.payload', JSON.stringify(payload));
    } catch (e) {
      /* Quota exceeded, sessionStorage disabled, etc. The runner
         will report "No project loaded" if we proceed, which is a
         worse error than naming what actually went wrong. */
      console.error('[run] failed to write payload to sessionStorage:', e);
      return;
    }

    if (previewStage) previewStage.classList.add('running');
    previewFrame.hidden = false;
    previewFrame.src = 'runtime/runner.html?t=' + Date.now();
  }

  if (playBtn) {
    playBtn.addEventListener('click', runProject);
  }
})();

/* Dock icon stubs. Click-log only — the panels these icons will
   open don't exist yet (Blueprints, Assets, Plugins, Output, Export
   are all v3). No active state is applied here; that wires in when
   real panel open/close lands. */
document.querySelectorAll('.dock-icon').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel ?? 'unknown';
    console.log(`[dock] ${panel}`);
  });
});

/* Fork button stub. Social / sharing actions belong to community
   features, which are prototyped-not-built per project.md. */
const forkBtn = document.getElementById('fork');
if (forkBtn) {
  forkBtn.addEventListener('click', () => {
    console.log('[fork]');
  });
}
