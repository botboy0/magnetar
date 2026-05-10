/* ============================================================
   project-storage.js
   localStorage-backed projects registry.

   Keys:
     magnetar.projects.index        → JSON array of project IDs
     magnetar.projects.<id>         → JSON project blob
     magnetar.session.activeProject → string ID (or absent)

   Project shape:
     { id, title, files: {filename: code}, activeFile,
       createdAt, updatedAt,
       description?, tags?, author?, thumb? }

   The optional fields are surfaced on the Projects-page cards
   (description on Examples; tags on both Yours and Examples)
   and in the editor's status-line (author, tags). `thumb` is a
   data: URL written by the editor after a successful Run — the
   Projects-page Yours card renders it behind the card-bed when
   present. Absent fields render as empty — no UI breaks on legacy
   projects.

   API is shaped around projects-plural so callers never encode
   a singular assumption. v2 UI only exercises one project at a
   time; the storage layer is ready for more when the Projects
   Navigator entry wires up.

   All reads/writes wrapped in try/catch. If localStorage is
   full, disabled, or corrupted, we fall through to a warning
   and let the caller cope — no crash.
   ============================================================ */

const K_INDEX  = 'magnetar.projects.index';
const K_ACTIVE = 'magnetar.session.activeProject';
const K_PROJECT = (id) => `magnetar.projects.${id}`;

/* ---------- low-level get/set/remove with try/catch ---------- */

function rawGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`[storage] read failed (${key}):`, e);
    return null;
  }
}

function rawSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`[storage] write failed (${key}):`, e);
    return false;
  }
}

function rawRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.warn(`[storage] remove failed (${key}):`, e);
    return false;
  }
}

function parseJSON(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[storage] corrupt JSON, using fallback:', e);
    return fallback;
  }
}

/* ---------- index (list of project IDs) ---------- */

function readIndex() {
  const arr = parseJSON(rawGet(K_INDEX), []);
  return Array.isArray(arr) ? arr : [];
}

function writeIndex(ids) {
  rawSet(K_INDEX, JSON.stringify(ids));
}

export function listProjectIds() {
  return readIndex();
}

/* ---------- session pointer ---------- */

export function getActiveProjectId() {
  return rawGet(K_ACTIVE);
}

export function setActiveProjectId(id) {
  if (id == null) {
    rawRemove(K_ACTIVE);
  } else {
    rawSet(K_ACTIVE, String(id));
  }
}

/* ---------- project CRUD ---------- */

export function loadProject(id) {
  if (!id) return null;
  return parseJSON(rawGet(K_PROJECT(id)), null);
}

/* Save the full project blob under its ID. Touches updatedAt.
   Callers pass the whole project object; we stamp the timestamp
   here so they never have to remember. If the project isn't in
   the index yet (shouldn't happen via normal flow, but defend
   against it), we add it so the registry stays consistent. */
export function saveProject(id, data) {
  if (!id || !data) return false;
  const stamped = { ...data, id, updatedAt: Date.now() };
  const ok = rawSet(K_PROJECT(id), JSON.stringify(stamped));
  if (!ok) return false;

  const index = readIndex();
  if (!index.includes(id)) {
    index.push(id);
    writeIndex(index);
  }
  return true;
}

/* Create a new project with a generated UUID.
   Returns the new ID, or null if storage failed. */
export function createProject({
  title = 'untitled',
  files = {},
  activeFile = null,
  description,
  tags,
  author,
  thumb,
} = {}) {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : fallbackId();

  const now = Date.now();
  const project = {
    id,
    title,
    files,
    activeFile: activeFile ?? Object.keys(files)[0] ?? null,
    createdAt: now,
    updatedAt: now,
    ...(description != null ? { description } : {}),
    ...(tags        != null ? { tags }        : {}),
    ...(author      != null ? { author }      : {}),
    ...(thumb       != null ? { thumb }       : {}),
  };

  const ok = rawSet(K_PROJECT(id), JSON.stringify(project));
  if (!ok) return null;

  const index = readIndex();
  index.push(id);
  writeIndex(index);

  return id;
}

export function deleteProject(id) {
  if (!id) return false;
  rawRemove(K_PROJECT(id));
  const index = readIndex().filter(x => x !== id);
  writeIndex(index);
  if (getActiveProjectId() === id) setActiveProjectId(null);
  return true;
}

/* Resolve a project title that doesn't collide with any existing
   project. Windows-style incrementing: "foo" → "foo (2)" → "foo (3)".
   Match is case-insensitive so "Breakout" colliding with "breakout"
   still increments; the returned title preserves the caller's case.

   Strips any existing " (N)" suffix on the input first, so passing
   in a previously-incremented title (e.g. duplicating "foo (2)")
   yields "foo (3)" rather than "foo (2) (2)".

   Capped at 9999 attempts — past that we return the bumped form
   unchanged, accepting the collision rather than spinning forever. */
export function uniqueTitle(desired) {
  const used = new Set(
    listProjectIds()
      .map(loadProject)
      .filter(Boolean)
      .map(p => (p.title ?? '').toLowerCase())
  );
  const base = (desired == null ? 'untitled' : String(desired));
  if (!used.has(base.toLowerCase())) return base;
  const m = base.match(/^(.+?) \((\d+)\)$/);
  const root = m ? m[1] : base;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${root} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${root} (9999)`;
}

/* UUID fallback for old browsers / non-secure contexts.
   RFC 4122 version 4 format, not cryptographically strong —
   this is a last-resort path and modern browsers won't hit it. */
function fallbackId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/* ---------- debounce helper ----------
   Small, dep-free. Used by the orchestrator to batch autosave
   writes on Monaco's onChange (one write per ~300ms of idle,
   not one per keystroke). */
export function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
  };
}
