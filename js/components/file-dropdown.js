/* ============================================================
   file-dropdown.js
   File switcher in the code panel header.

   D1 — list + click-to-switch + cyan-dot active indicator.
   D2 — delete (trash icon on hover + modal confirm).
   D3 — add (+ New file row, inline create) and rename (pen
        icon on hover, inline rename). Shared validation +
        inline error display.

   The dropdown is owned by this module. The orchestrator in
   main-editor.js passes in the project reference and callbacks
   (onSwitch, onDelete, onAdd, onRename); the module reads
   project.files and project.activeFile at render time.

   Menu visibility:
   - Click the button → toggle.
   - Click outside → close.
   - Escape → close (also cancels in-flight rename/create).
   - Click a file row (non-edit) → switch + close.

   The protected entry point `main.lua` has no trash or pen
   icons — delete and rename are blocked at the UI level so
   users can't accidentally destroy their project's entry
   point. Attempting to create or rename to `main.lua` also
   trips the duplicate-name validation.

   Validation (applied to create and rename):
   - First char: [a-zA-Z0-9_]
   - Body chars (before .lua): [a-zA-Z0-9_-]*
   - Must end in .lua (auto-appended if omitted; other
     extensions rejected)
   - Trim whitespace; empty-after-trim is a silent revert
     on rename, cancel on "+ New"
   - Case-insensitive duplicate check against existing files
   - Max total length 64 chars
   ============================================================ */

import { confirm } from './modal.js';

const ENTRY_POINT = 'main.lua';
const MAX_LEN = 64;

let state = null; // { button, menu, project, onSwitch, onDelete, onAdd, onRename }

export function initFileDropdown(project, callbacks = {}) {
  const button = document.querySelector('.file-select');
  if (!button) {
    console.warn('[file-dropdown] .file-select button not found');
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'file-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  button.insertAdjacentElement('afterend', menu);

  state = {
    button,
    menu,
    project,
    onSwitch: callbacks.onSwitch,
    onDelete: callbacks.onDelete,
    onAdd: callbacks.onAdd,
    onRename: callbacks.onRename,
  };

  updateButtonLabel();
  renderMenu();

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== button) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) closeMenu();
  });
}

export function refresh() {
  if (!state) return;
  updateButtonLabel();
  renderMenu();
}

/* ---------- menu structure ---------- */

function updateButtonLabel() {
  const { button, project } = state;
  const name = project.activeFile ?? '';
  const caret = button.querySelector('.caret');
  button.textContent = name + ' ';
  if (caret) button.appendChild(caret);
  button.setAttribute('title', name);
}

function renderMenu() {
  const { menu, project } = state;
  menu.innerHTML = '';

  const filenames = Object.keys(project.files).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  for (const filename of filenames) {
    menu.appendChild(buildFileRow(filename));
  }

  menu.appendChild(buildNewRow());
}

function buildFileRow(filename) {
  const { project } = state;

  const row = document.createElement('div');
  row.className = 'file-row';
  row.setAttribute('role', 'menuitem');
  row.dataset.filename = filename;
  if (filename === project.activeFile) row.classList.add('active');

  const dot = document.createElement('span');
  dot.className = 'file-row-dot';
  row.appendChild(dot);

  const label = document.createElement('span');
  label.className = 'file-row-name';
  label.textContent = filename;
  row.appendChild(label);

  const actions = document.createElement('span');
  actions.className = 'file-row-actions';
  row.appendChild(actions);

  if (filename !== ENTRY_POINT) {
    actions.appendChild(buildPenButton(filename, row, label));
    actions.appendChild(buildTrashButton(filename));
  }

  row.addEventListener('click', (e) => {
    /* Edit state owns all interactions inside the row. */
    if (row.classList.contains('editing')) return;
    if (e.target.closest('.file-row-pen, .file-row-trash')) return;
    if (filename !== state.project.activeFile && state.onSwitch) {
      state.onSwitch(filename);
    }
    closeMenu();
  });

  return row;
}

function buildPenButton(filename, row, label) {
  const pen = document.createElement('button');
  pen.className = 'file-row-pen';
  pen.setAttribute('type', 'button');
  pen.setAttribute('aria-label', `Rename ${filename}`);
  pen.title = `Rename ${filename}`;
  pen.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
  `;
  pen.addEventListener('click', (e) => {
    e.stopPropagation();
    beginRename(row, label, filename);
  });
  return pen;
}

function buildTrashButton(filename) {
  const trash = document.createElement('button');
  trash.className = 'file-row-trash';
  trash.setAttribute('type', 'button');
  trash.setAttribute('aria-label', `Delete ${filename}`);
  trash.title = `Delete ${filename}`;
  trash.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18"/>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `;
  trash.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete file',
      message: `Delete ${filename}? This can't be undone.`,
      confirmLabel: 'Delete',
      confirmVariant: 'destructive',
    });
    if (ok && state.onDelete) state.onDelete(filename);
  });
  return trash;
}

/* The "+ New file" row at the bottom of the menu. Clicking it
   enters create mode — the row transforms into an empty input
   with the same grammar as rename. Shares validation. */
function buildNewRow() {
  const row = document.createElement('div');
  row.className = 'file-row file-row-new';
  row.setAttribute('role', 'menuitem');

  const plus = document.createElement('span');
  plus.className = 'file-row-dot'; // reuse the slot for alignment
  plus.textContent = '+';
  row.appendChild(plus);

  const label = document.createElement('span');
  label.className = 'file-row-name';
  label.textContent = 'New file';
  row.appendChild(label);

  row.addEventListener('click', (e) => {
    if (row.classList.contains('editing')) return;
    e.stopPropagation();
    beginCreate(row, label);
  });

  return row;
}

/* ---------- inline edit: rename ---------- */

function beginRename(row, labelSpan, originalName) {
  row.classList.add('editing');
  const input = makeInput(originalName, MAX_LEN);
  labelSpan.replaceWith(input);
  input.focus();
  input.select();

  const errorEl = attachError(row);

  let settled = false;

  const commit = () => {
    if (settled) return;
    const raw = input.value.trim();

    /* Empty after trim = silent revert (= cancel). */
    if (!raw) {
      revert();
      return;
    }

    const normalized = normalizeExtension(raw);
    const err = validate(normalized, { excludeSelf: originalName });
    if (err) {
      errorEl.textContent = err;
      errorEl.hidden = false;
      input.focus();
      return;
    }

    settled = true;
    cleanup(row, errorEl);
    /* If the name didn't actually change (user committed with
       the same text), just drop back to display state — no
       rename needed. */
    if (normalized === originalName) {
      restoreLabel(row, originalName);
      return;
    }
    if (state.onRename) state.onRename(originalName, normalized);
  };

  const revert = () => {
    if (settled) return;
    settled = true;
    cleanup(row, errorEl);
    restoreLabel(row, originalName);
  };

  input.addEventListener('input', () => {
    errorEl.hidden = true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  input.addEventListener('blur', commit);
}

/* ---------- inline edit: create ---------- */

function beginCreate(row, labelSpan) {
  row.classList.add('editing');
  const input = makeInput('', MAX_LEN);
  input.placeholder = 'filename';
  labelSpan.replaceWith(input);
  input.focus();

  const errorEl = attachError(row);

  let settled = false;

  const commit = () => {
    if (settled) return;
    const raw = input.value.trim();

    /* Empty on "+ New" = cancel (no file created). */
    if (!raw) {
      revert();
      return;
    }

    const normalized = normalizeExtension(raw);
    const err = validate(normalized);
    if (err) {
      errorEl.textContent = err;
      errorEl.hidden = false;
      input.focus();
      return;
    }

    settled = true;
    cleanup(row, errorEl);
    restoreNewLabel(row);
    if (state.onAdd) state.onAdd(normalized);
  };

  const revert = () => {
    if (settled) return;
    settled = true;
    cleanup(row, errorEl);
    restoreNewLabel(row);
  };

  input.addEventListener('input', () => {
    errorEl.hidden = true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  input.addEventListener('blur', commit);
}

/* ---------- edit helpers ---------- */

function makeInput(initialValue, maxLen) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'file-row-input';
  input.value = initialValue;
  input.maxLength = maxLen;
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

function attachError(row) {
  const el = document.createElement('div');
  el.className = 'file-row-error';
  el.hidden = true;
  row.insertAdjacentElement('afterend', el);
  return el;
}

function cleanup(row, errorEl) {
  row.classList.remove('editing');
  errorEl.remove();
}

/* Swap the input back to a label span. Used after rename
   commit (when the name didn't change) and after rename revert. */
function restoreLabel(row, filename) {
  const input = row.querySelector('.file-row-input');
  if (!input) return;
  const span = document.createElement('span');
  span.className = 'file-row-name';
  span.textContent = filename;
  input.replaceWith(span);
}

/* Swap the "+ New file" row's input back to its label. Used
   after create commit (refresh() will rebuild the menu from
   scratch, but until that happens we keep the row sensible)
   and after create revert. */
function restoreNewLabel(row) {
  const input = row.querySelector('.file-row-input');
  if (!input) return;
  const span = document.createElement('span');
  span.className = 'file-row-name';
  span.textContent = 'New file';
  input.replaceWith(span);
}

/* ---------- validation ---------- */

/* Auto-append .lua if the user didn't type an extension.
   If they typed a different extension (e.g. foo.js), leave
   it as-is and let validate() reject it with the specific
   "must end in .lua" message. */
function normalizeExtension(raw) {
  if (raw.includes('.')) return raw;
  return raw + '.lua';
}

/* Returns null if valid, or an error message string if not.
   `excludeSelf` skips the duplicate check against a specific
   filename — used by rename so a user can commit a rename
   that keeps the same name (no-op case) without tripping
   the duplicate rule against the file being renamed. */
function validate(filename, { excludeSelf = null } = {}) {
  if (!filename) return 'needs a name';
  if (filename.length > MAX_LEN) return 'too long (max 64)';
  if (!filename.endsWith('.lua')) return 'must end in .lua';

  const base = filename.slice(0, -'.lua'.length);
  if (!base) return 'needs a name';
  if (!/^[a-zA-Z0-9_]/.test(base)) return 'must start with a letter, number, or underscore';
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(base)) return 'letters, numbers, _ and - only';

  /* Case-insensitive duplicate check against existing files. */
  const lower = filename.toLowerCase();
  const existing = Object.keys(state.project.files);
  for (const name of existing) {
    if (excludeSelf && name === excludeSelf) continue;
    if (name.toLowerCase() === lower) return 'already exists';
  }

  return null;
}

/* ---------- menu visibility ---------- */

function toggleMenu() {
  state.menu.hidden = !state.menu.hidden;
}

function closeMenu() {
  state.menu.hidden = true;
}
