import { init as initTopStrip } from './components/top-strip.js';
import { initEditor } from './components/editor-mount.js';
import {
  getActiveProjectId,
  setActiveProjectId,
  loadProject,
  saveProject,
  createProject,
  debounce,
} from './components/project-storage.js';
import { initProjectRename } from './components/project-rename.js';

initTopStrip();

// Project loading and seeding logic. On boot, we check for an active project ID
async function bootstrapProject() {
  const existingId = getActiveProjectId();
  if (existingId) {
    const existing = loadProject(existingId);
    if (existing) return existing;
    /* Pointer exists but blob is missing/corrupt. Clear and
       fall through to create a fresh starter project. */
    setActiveProjectId(null);
  }

  // First visit (or recovered-from-corruption): seed a new project with hello.lua as the starter file
  let starterCode = '-- could not load fixture\n';
  try {
    const res = await fetch('fixtures/hello.lua');
    if (res.ok) starterCode = await res.text();
  } catch (e) {
    console.warn('[editor] failed to load starter fixture:', e);
  }

  const newId = createProject({
    title: 'untitled',
    files: { 'hello.lua': starterCode },
    activeFile: 'hello.lua',
  });

  if (!newId) {
//     localStorage is unavailable warn and proceed without persistence. 
    console.warn('[editor] storage unavailable — running in-memory only');
    return {
      id: null,
      title: 'untitled',
      files: { 'hello.lua': starterCode },
      activeFile: 'hello.lua',
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
  const initialCode = project.files[project.activeFile] ?? '';

  let editor;
  try {
    editor = await initEditor(mount, { value: initialCode });
  } catch (e) {
    console.error('[editor] Monaco mount failed:', e);
    return;
  }

  /* Autosave: write the current buffer back to the active
     file's slot, debounced so we don't thrash localStorage on
     every keystroke. 300ms lands between "responsive enough
     the user trusts their changes stuck" and "quiet enough
     that typing doesn't hammer disk". */
  const persist = debounce(() => {
    if (!project.id) return; /* in-memory fallback: nothing to save */
    project.files[project.activeFile] = editor.getValue();
    saveProject(project.id, project);
  }, 300);

  editor.onDidChangeModelContent(persist);

  /* Project-title rename. Commit writes project.title and
     persists immediately (not debounced — rename is a discrete
     action, not a stream of keystrokes). */
  initProjectRename(project, {
    onCommit: () => {
      if (!project.id) return;
      saveProject(project.id, project);
    },
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
