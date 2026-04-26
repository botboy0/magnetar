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
   c5b2 — Ctrl+Enter keybinding (Monaco-scoped) for runProject.
   c5b3 — runner→editor postMessage channel; Ctrl+Enter works
          even when focus is inside the preview iframe.
   c5b4 — document-level Ctrl+Enter fallback for editor-frame
          focus that's outside Monaco (body, dropdown, Run button).
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

  /* ---------- Runtime status & metrics (c5c) ----------
     Two separate concerns sharing the same lifecycle events:

       BADGE (.status-line) — stationary state indicator:
         idle    — pre-run, neutral chip
         running — engine up, cyan
         errored — exception or validation failure, orange + first
                   line of message
       The badge text doesn't change while in a state; it's a status
       light, not a counter.

       METRICS (.preview-strip) — live runtime values:
         t   — elapsed seconds since run started, ticks ~10×/sec
         fps — runtime frame rate (placeholder — Love.js doesn't
               expose getFPS through the C ABI we have access to;
               wiring this needs a `conf.lua` cooperation pattern,
               deferred)
         res — actual canvas dimensions reported by the runner once
               the engine boots (replaces the previous hardcoded
               "800 × 500" placeholder, which has been wrong since
               c5b1.5 made canvas size project-controlled via conf.lua)

     Both are driven by the same magnetar.status / magnetar.error
     messages plus the editor-side optimistic flip on Run. Splitting
     the rendering targets keeps the badge calm and lets the strip
     be busy. */
  const runtimeBadge = document.getElementById('runtime-badge');
  const metricT = document.getElementById('metric-t');
  const metricRes = document.getElementById('metric-res');
  let runStartTime = 0;
  let runDurationInterval = null;

  function clearRunDurationInterval() {
    if (runDurationInterval !== null) {
      clearInterval(runDurationInterval);
      runDurationInterval = null;
    }
  }

  function setRuntimeStatus(state, detail) {
    if (!runtimeBadge) return;

    /* Badge: stationary state indicator. Three classes, one active. */
    runtimeBadge.classList.remove('idle', 'ok', 'err');
    if (state === 'running') {
      runtimeBadge.classList.add('ok');
      runtimeBadge.textContent = 'Running';
    } else if (state === 'errored') {
      runtimeBadge.classList.add('err');
      /* Surface only the first line; long messages would bust the
         status-line layout and the user has the console for details. */
      const firstLine = (detail || 'Error').split('\n')[0].trim() || 'Error';
      runtimeBadge.textContent = firstLine;
    } else {
      // idle or unknown
      runtimeBadge.classList.add('idle');
      runtimeBadge.textContent = 'Idle';
    }

    /* t metric: ticks while running, em-dash otherwise.
       100ms tick + 1 decimal: the displayed value changes 10×/sec,
       and a 100ms tick rate is exactly enough to show each value
       once. */
    clearRunDurationInterval();
    if (state === 'running') {
      runStartTime = Date.now();
      const tick = () => {
        if (!metricT) return;
        const elapsed = (Date.now() - runStartTime) / 1000;
        metricT.textContent = `${elapsed.toFixed(1)}s`;
      };
      tick(); // immediate render so we don't show stale "—" for 100ms
      runDurationInterval = setInterval(tick, 100);
    } else if (metricT) {
      metricT.textContent = '—';
    }

    /* res metric: clear on idle/errored. magnetar.status with
       canvas dims will repopulate when the next run starts. */
    if (state !== 'running' && metricRes) {
      metricRes.textContent = '—';
    }
  }

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

    /* Optimistic state flip: badge says "running" the moment we
       trigger the run, before the runner has even loaded. This
       means a rerun-after-error visibly clears the orange badge
       immediately rather than waiting ~1s for the engine to boot
       and post its own magnetar.status. The runner's confirmation
       message just resets the start time, which is the right
       behavior — count from when the engine actually came up. */
    setRuntimeStatus('running');
  }

  if (playBtn) {
    playBtn.addEventListener('click', runProject);
  }

  /* ---------- Run keybinding (c5b2) ----------
     Ctrl+Enter / Cmd+Enter inside Monaco runs the project. Same
     handler as the click — no separate code path to keep in sync.

     Monaco-only by design: addCommand only fires when the editor
     has focus. That covers the >95% case (user is typing code,
     hits the shortcut to run). Cases like "user clicked into the
     iframe and now wants to rerun" need the Run button instead;
     adding a document-level fallback is one extra binding away if
     it ever earns its keep, but we're not paying for it speculatively.

     window.monaco is set by editor-mount.js's AMD loader and is
     guaranteed to exist by the time this IIFE reaches here (we
     awaited initEditor above). */
  if (window.monaco) {
    editor.addCommand(
      window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.Enter,
      runProject
    );
  }

  /* ---------- Runner → editor messages (c5b3) ----------
     The runner forwards modified keystrokes (today: Ctrl+Enter)
     up to the parent because keystrokes inside the iframe don't
     reach Monaco's command system. This listener completes the
     channel: runner posts {type: 'magnetar.run'}, we run.

     Source validation: only accept messages from our own iframe.
     postMessage is broadcast — any page can send our window a
     message. Filtering by source keeps a malicious tab on a
     different origin from triggering runs. We don't bother
     checking origin (same-origin guarantees the source check is
     sufficient).

     Forward-compat: unknown message types are ignored, not
     errored. New types can be added (e.g. magnetar.error,
     magnetar.status for c5c) without breaking older runners.
     See runtime/PROTOCOL.md for the channel spec. */
  window.addEventListener('message', (e) => {
    if (!previewFrame || e.source !== previewFrame.contentWindow) return;
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'magnetar.run') {
      runProject();
    } else if (e.data.type === 'magnetar.status') {
      /* state='running' confirms the engine actually came up. Resets
         the duration counter so it counts from real engine-ready,
         not from the click. */
      if (e.data.state === 'running') {
        setRuntimeStatus('running');
      } else if (e.data.state === 'idle') {
        setRuntimeStatus('idle');
      }
      /* canvas dims (optional, may arrive in a separate message
         with no `state`) populate the `res` metric. The runner polls
         canvas.width/height for ~3s after engine-ready and posts
         when it changes — first change is conf.lua-driven, later
         changes are runtime love.window.setMode calls. */
      if (e.data.canvas && metricRes) {
        const w = e.data.canvas.width | 0;
        const h = e.data.canvas.height | 0;
        if (w > 0 && h > 0) {
          metricRes.textContent = `${w} × ${h}`;
        }
      }
    } else if (e.data.type === 'magnetar.error') {
      setRuntimeStatus('errored', e.data.message);
    }
  });

  /* ---------- Document-level Ctrl+Enter fallback (c5b4) ----------
     Catches Ctrl+Enter when focus is in the editor frame but
     outside Monaco — body, file dropdown, the Run button itself,
     etc. Without this, those focus states are dead zones for the
     shortcut, which surprises users who expect "Ctrl+Enter runs"
     to work everywhere in the editor.

     Layering with the other two run-trigger paths:
       - Monaco focus → editor.addCommand intercepts before bubble.
       - Iframe focus → runner postMessage handler fires above.
       - Anywhere else in the editor frame → this listener.
     Three paths, one runProject().

     Input guard: skip when focus is inside any text input element,
     so the project-title rename input's Enter still commits the
     rename and doesn't double-fire as Run. Monaco's editor uses
     a contenteditable surface, not <input>/<textarea>, so this
     guard doesn't accidentally suppress Monaco's case (which is
     already handled by addCommand anyway).

     When a real keybind dispatcher lands later, this listener is
     the natural anchor for it — the dispatcher reuses the same
     insertion point and routes by registered binding instead of
     hardcoding Ctrl+Enter → run. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    runProject();
  });
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
