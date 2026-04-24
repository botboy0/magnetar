/* ============================================================
   editor-mount.js
   Monaco lifecycle: loader config, theme definition, instance
   creation, and a models registry for multi-file editing.

   Scope boundary:
   - Owns Monaco loader handshake and the `magnetar` theme.
   - Owns the filename → model map. Models are the runtime
     source of truth for file content; storage is the
     persistence layer, written by the orchestrator via
     onDidChangeModelContent on the editor.
   - Knows nothing about projects, storage, or Run.

   The models registry is module-private — a single Map keyed
   by filename. Models live for the editor's lifetime; callers
   manage creation (createModels at boot, createModel on add),
   disposal (disposeModel on delete), and rename (renameModel).

   Theme is defined exactly once per page. initEditor() can be
   called more than once, but the theme definition is gated.
   ============================================================ */

const MONACO_VS_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs';

let monacoReady = null;   // cached loader promise — one handshake per page
let themeDefined = false; // gate so we don't redefine on subsequent mounts

/* Filename → Monaco model. Populated by createModels on boot;
   mutated by createModel / disposeModel / renameModel as files
   come and go. */
const models = new Map();

/* Resolve once Monaco's AMD loader has produced `monaco` globally.
   The <script> tag for loader.js is in editor.html's <head>; if it
   failed to load (offline, CDN down) we reject so callers can surface
   something useful rather than hanging on a never-ready promise. */
function loadMonaco() {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise((resolve, reject) => {
    if (typeof require === 'undefined') {
      reject(new Error('Monaco loader script not found. Check editor.html <head>.'));
      return;
    }
    require.config({ paths: { vs: MONACO_VS_PATH } });
    require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
  });
  return monacoReady;
}

function defineMagnetarTheme(monaco) {
  if (themeDefined) return;
  monaco.editor.defineTheme('magnetar', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background':                '#0a0a0f',
      'editor.foreground':                '#d1d5db',
      'editorLineNumber.foreground':      '#4a4d57',
      'editorLineNumber.activeForeground':'#d1d5db',
      'editorCursor.foreground':          '#06b6d4',
      'editor.lineHighlightBackground':   '#00000000',
    },
  });
  themeDefined = true;
}

/* Mount Monaco into `element` and seed the models registry.

   `files` is { filename: code }, `activeFile` names which model
   the editor mounts with. The returned editor's model is the
   one for activeFile; other models exist in the registry ready
   to setModel() into. Callers switch files via setModel +
   whatever state tracking they own (project.activeFile). */
export async function initEditor(element, { files = {}, activeFile = null } = {}) {
  if (!element) throw new Error('initEditor: mount element is required');
  if (!activeFile || !(activeFile in files)) {
    throw new Error('initEditor: activeFile must be a key in files');
  }

  const monaco = await loadMonaco();
  defineMagnetarTheme(monaco);

  element.innerHTML = '';

  /* Seed every file's model up front. At v2 scale (1–10 files per
     project) this is near-free; lazy hydration would be premature.
     See the drawbacks discussion in the c4d design conversation. */
  createModels(files);

  const editor = monaco.editor.create(element, {
    model: models.get(activeFile),
    language: 'lua',
    theme: 'magnetar',
    automaticLayout: true,
    tabSize: 2,
    minimap: { enabled: false },
    scrollbar: { horizontal: 'hidden', verticalScrollbarSize: 8 },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
  });

  /* Force one layout pass after mount. automaticLayout handles
     subsequent resizes; the initial measurement can race with
     flex/grid settling on first paint, and an explicit layout()
     on the next frame sidesteps that. */
  requestAnimationFrame(() => editor.layout());

  return editor;
}

/* ---------- models registry API ---------- */

/* Create a model per entry in `files`. Skips filenames that
   already have a model (idempotent — safe to call on reload
   paths though we don't currently use that). */
export function createModels(files) {
  const monaco = window.monaco;
  if (!monaco) throw new Error('createModels: Monaco not loaded yet');
  for (const [name, code] of Object.entries(files)) {
    if (models.has(name)) continue;
    const model = monaco.editor.createModel(code, 'lua');
    models.set(name, model);
  }
}

/* Create a single model for a new file. Used when the user
   adds a file via the dropdown. */
export function createModel(filename, code = '') {
  const monaco = window.monaco;
  if (!monaco) throw new Error('createModel: Monaco not loaded yet');
  if (models.has(filename)) return models.get(filename);
  const model = monaco.editor.createModel(code, 'lua');
  models.set(filename, model);
  return model;
}

export function getModel(filename) {
  return models.get(filename) ?? null;
}

/* Dispose and remove. Callers are responsible for ensuring the
   editor is not currently pointed at this model (setModel to a
   different one first). Disposing the active model leaves the
   editor in a weird state. */
export function disposeModel(filename) {
  const m = models.get(filename);
  if (!m) return false;
  m.dispose();
  models.delete(filename);
  return true;
}

/* Rename: create a new model with the old model's text under
   the new name. Does NOT dispose the old model — the caller
   must dispose it separately via disposeModel(oldName), AFTER
   the editor has setModel'd to the new one (or to something
   else entirely). Disposing the currently-attached model leaves
   the editor in a broken state.

   Per the c4d design discussion: rename loses undo history
   (Monaco models are identified by URI; preserving history
   across a rename requires manual edit-stack replay, deferred). */
export function renameModel(oldName, newName) {
  const old = models.get(oldName);
  if (!old) return null;
  if (models.has(newName)) throw new Error(`renameModel: ${newName} already exists`);
  const text = old.getValue();
  const monaco = window.monaco;
  const fresh = monaco.editor.createModel(text, 'lua');
  models.set(newName, fresh);
  /* Old model stays live in the registry under the old name
     until the caller disposes it. This two-step dance lets the
     caller do: renameModel → editor.setModel(fresh) → disposeModel(old) */
  return fresh;
}
