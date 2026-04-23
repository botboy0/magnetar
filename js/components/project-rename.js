/* ============================================================
   project-rename.js
   Pen-icon → inline-rename behavior for the project title.

   Two DOM nodes currently display the title:
     .topstrip .project-title
     .status-line .meta-title
   Both update in sync when rename commits.

   ⚠️ MIGRATION TRIGGER:
   If a third display of the project title is ever added, this
   module must be refactored to emit a `project:titlechange`
   event on document (or similar pub/sub) rather than updating
   nodes directly. Two direct updates is fine; three is the
   threshold where ad-hoc coupling starts to rot. Do not add a
   third direct update — that's the signal to generalize.

   Commit mechanics (locked in conversation):
     - Enter or blur commits
     - Escape reverts
     - Empty-after-trim reverts silently (= cancel)
     - Title clipped silently to MAX_LEN chars
     - Pen hides while editing
     - Existing text is selected on focus
   ============================================================ */

const MAX_LEN = 60;

/* Public entry point. Called once from main-editor.js with the
   bootstrapped project. Mutates project.title on commit and
   invokes onCommit so the orchestrator can persist. */
export function initProjectRename(project, { onCommit } = {}) {
  const titleEl = document.querySelector('.topstrip .project-title');
  const metaEl  = document.querySelector('.status-line .meta-title');
  const penEl   = document.querySelector('.topstrip .project-pen');

  if (!titleEl || !penEl) {
    console.warn('[rename] project-title or project-pen missing from DOM');
    return;
  }

  /* Seed both display nodes from the project. Chunk B left them
     as hardcoded "untitled" in HTML; we replace that with the
     actual stored value on boot. */
  applyTitle(project.title, titleEl, metaEl);

  penEl.addEventListener('click', () => {
    beginEdit(titleEl, metaEl, penEl, project, onCommit);
  });
}

function applyTitle(title, titleEl, metaEl) {
  titleEl.textContent = title;
  if (metaEl) metaEl.textContent = title;
}

function beginEdit(titleEl, metaEl, penEl, project, onCommit) {
  const current = project.title;

  /* Swap the span for an input. Width is measured from the span
     so the input starts at roughly the same visual size — then
     it grows/shrinks naturally as the user types via a small
     input-event width adjustment. */
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'project-title-input';
  input.value = current;
  input.maxLength = MAX_LEN;
  input.setAttribute('aria-label', 'Project title');

  titleEl.replaceWith(input);
  penEl.style.visibility = 'hidden';

  /* Size the input to its content. Uses a hidden sizer span to
     measure text width in the same font/size. Called once at
     mount and on every input event. */
  const sizer = makeSizer(input);
  fitInputWidth(input, sizer);
  input.addEventListener('input', () => fitInputWidth(input, sizer));

  input.focus();
  input.select();

  let settled = false;

  const commit = () => {
    if (settled) return;
    settled = true;

    let next = input.value.trim().slice(0, MAX_LEN);
    if (!next) next = current; /* empty-after-trim = revert */

    endEdit(input, sizer, titleEl, penEl);
    applyTitle(next, titleEl, metaEl);

    if (next !== current) {
      project.title = next;
      if (onCommit) onCommit();
    }
  };

  const revert = () => {
    if (settled) return;
    settled = true;
    endEdit(input, sizer, titleEl, penEl);
    applyTitle(current, titleEl, metaEl);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  input.addEventListener('blur', commit);
}

/* Restore the original span in place of the input and unhide
   the pen. The span's text content is set by applyTitle() in
   the caller — we just rebuild the DOM shape here. */
function endEdit(input, sizer, titleEl, penEl) {
  sizer.remove();
  input.replaceWith(titleEl);
  penEl.style.visibility = '';
}

/* Hidden off-screen span that mirrors the input's typography
   so we can measure text width. Created once per edit session. */
function makeSizer(input) {
  const sizer = document.createElement('span');
  sizer.setAttribute('aria-hidden', 'true');
  sizer.style.position = 'absolute';
  sizer.style.visibility = 'hidden';
  sizer.style.whiteSpace = 'pre';
  sizer.style.left = '-9999px';
  sizer.style.top = '0';
  /* Inherit typography from the input's computed style at
     measure time — beginEdit() calls fitInputWidth() after
     the input is in the DOM so this works. */
  document.body.appendChild(sizer);
  return sizer;
}

function fitInputWidth(input, sizer) {
  const cs = getComputedStyle(input);
  sizer.style.font = cs.font;
  sizer.style.letterSpacing = cs.letterSpacing;
  sizer.textContent = input.value || input.placeholder || ' ';
  /* +2px so the caret doesn't hug the right edge */
  input.style.width = (sizer.offsetWidth + 2) + 'px';
}
