/* ============================================================
   editor-mount.js
   Monaco lifecycle: loader config, theme definition, instance
   creation. Returns a promise that resolves to the editor.

   Scope boundary:
   - Owns Monaco loader handshake and the `magnetar` theme.
   - Knows nothing about projects, files, storage, or Run.
     The orchestrator in main-editor.js wires those in.

   The theme is defined exactly once per page lifetime (Monaco
   throws if you redefine a theme name). initEditor() can be
   called more than once on the same page (e.g. future remount),
   but the theme definition is gated.
   ============================================================ */

const MONACO_VS_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs';

let monacoReady = null;   // cached loader promise — one handshake per page
let themeDefined = false; // gate so we don't redefine on subsequent mounts

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

/* Mount Monaco into `element` with initial `value`.

   The mount element in c3 contains a <pre> placeholder so the code
   panel isn't empty before Monaco loads. Monaco's editor.create()
   appends a child into the target, it doesn't replace content — so
   we clear the element first to avoid the placeholder leaking
   underneath the editor chrome.

   `automaticLayout: true` makes Monaco observe its own container
   and relayout on resize. This is load-bearing for our flex/grid
   editor shell; without it, Monaco measures its container once at
   creation time and never adjusts, which causes the "Monaco blows
   off the right edge" bug the c3 handoff §5 flags. Don't remove it. */
export async function initEditor(element, { value = '' } = {}) {
  if (!element) throw new Error('initEditor: mount element is required');

  const monaco = await loadMonaco();
  defineMagnetarTheme(monaco);

  element.innerHTML = '';

  const editor = monaco.editor.create(element, {
    value,
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
