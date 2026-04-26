/* ============================================================
   project-rename.js
   Pen-icon → inline-rename behavior for the project title.

   Title display is now event-driven: this module dispatches a
   `project:titlechange` CustomEvent on `document` whenever the
   title needs to render (initial seed and every commit). Display
   surfaces (topstrip, status-line, preview-stage, future project
   list) listen and update themselves.

   Migration history:
     c2-c5b1: two direct mutations (.topstrip .project-title and
              .status-line .meta-title) inside this module. The
              header comment flagged a third update site as the
              refactor trigger.
     c5b1.6:  preview-stage title was the third site. Flipped to
              event-driven here. Adding a fourth listener now
              costs zero changes in this module.

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
   invokes onCommit so the orchestrator can persist. Dispatches
   project:titlechange for display surfaces to render. */
export function initProjectRename(project, { onCommit } = {}) {
  const titleEl = document.querySelector('.topstrip .project-title');
  const penEl   = document.querySelector('.topstrip .project-pen');

  if (!titleEl || !penEl) {
    console.warn('[rename] project-title or project-pen missing from DOM');
    return;
  }

  /* Seed all display surfaces from the project. */
  emitTitleChange(project.title);

  penEl.addEventListener('click', () => {
    beginEdit(titleEl, penEl, project, onCommit);
  });
}

/* Dispatch the title to anyone listening. Detail carries the
   current title; listeners update their own DOM. */
function emitTitleChange(title) {
  document.dispatchEvent(new CustomEvent('project:titlechange', {
    detail: { title },
  }));
}

function beginEdit(titleEl, penEl, project, onCommit) {
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
    emitTitleChange(next);

    if (next !== current) {
      project.title = next;
      if (onCommit) onCommit();
    }
  };

  const revert = () => {
    if (settled) return;
    settled = true;
    endEdit(input, sizer, titleEl, penEl);
    emitTitleChange(current);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  input.addEventListener('blur', commit);
}

/* Restore the original span in place of the input and unhide
   the pen. The span's text content is set by the title-change
   listener in main-editor.js (driven by emitTitleChange) — we
   just rebuild the DOM shape here. */
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
