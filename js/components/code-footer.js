/* ============================================================
   code-footer.js
   Live updates for the bottom strip of the code panel:
   language/runtime label on the left, cursor position + char
   count on the right.

   Wires three Monaco hooks:
     - onDidChangeCursorPosition: line / column display
     - onDidChangeModelContent:   character count
     - onDidChangeModel:          re-seed everything on file
                                  switch (cursor + chars + language)

   Language label is derived from the active file's extension
   via a small lookup. Today every file is .lua and the runtime
   is Love2D, so the label is effectively static — but keeping
   it derived means the footer is correct the day a non-lua
   language lands without a follow-up wiring pass.
   ============================================================ */

const LANGUAGES = {
  lua: 'lua · love2d',
};

export function initCodeFooter(editor, project) {
  const footer = document.querySelector('.code-footer');
  if (!footer) {
    console.warn('[code-footer] .code-footer not found');
    return;
  }

  const langEl     = footer.querySelector('.left .lang');
  const autosaveEl = footer.querySelector('.left .autosave');
  const posEl      = footer.querySelector('.right > span:nth-child(1)');
  const charsEl    = footer.querySelector('.right > span:nth-child(3)');

  if (!langEl || !posEl || !charsEl || !autosaveEl) {
    console.warn('[code-footer] expected spans not found');
    return;
  }

  const renderPos = () => {
    const p = editor.getPosition();
    posEl.textContent = p ? `ln ${p.lineNumber}, col ${p.column}` : 'ln —, col —';
  };

  const renderChars = () => {
    const model = editor.getModel();
    /* getValueLength is O(1) on Monaco's model — preferred
       over getValue().length which builds the full string. */
    const n = model ? model.getValueLength() : 0;
    charsEl.textContent = `${n.toLocaleString()} chars`;
  };

  const renderLang = () => {
    const name = project.activeFile || '';
    const ext = name.toLowerCase().split('.').pop();
    langEl.textContent = LANGUAGES[ext] || ext || '—';
  };

  /* Initial seed — Monaco events only fire on change, so the
     footer would otherwise stay at its hardcoded em-dash state
     until the user types or moves the cursor. */
  renderPos();
  renderChars();
  renderLang();

  editor.onDidChangeCursorPosition(renderPos);
  editor.onDidChangeModelContent(renderChars);

  /* File switch (setModel from the file-dropdown) doesn't fire
     onDidChangeCursorPosition or onDidChangeModelContent on its
     own — re-seed all three so the footer reflects the new file
     immediately, including its character count and language. */
  editor.onDidChangeModel(() => {
    renderPos();
    renderChars();
    renderLang();
  });

  /* Autosave indicator — transient, not a permanent label.
     "saving…" shows while the debounced persist is queued or
     running; "auto-saved" flashes for ~2s after the write completes,
     then clears. Idle state is blank: a quiet footer reads as
     "nothing pending" without the text claiming to track it. */
  autosaveEl.textContent = '';
  let autosaveClearT = null;

  document.addEventListener('project:saving', () => {
    if (autosaveClearT) { clearTimeout(autosaveClearT); autosaveClearT = null; }
    autosaveEl.textContent = 'saving…';
  });
  document.addEventListener('project:saved', () => {
    autosaveEl.textContent = 'auto-saved';
    if (autosaveClearT) clearTimeout(autosaveClearT);
    autosaveClearT = setTimeout(() => {
      autosaveEl.textContent = '';
      autosaveClearT = null;
    }, 2000);
  });
}
