/* ============================================================
   modal.js
   Reusable confirmation modal primitive.

   API:
     const ok = await confirm({
       title,            // string, Syne display
       message,          // string, body copy
       confirmLabel,     // string, defaults to "Confirm"
       confirmVariant,   // "default" | "destructive" (default "default")
     });
     // ok === true   user confirmed
     // ok === false  user cancelled (backdrop / Escape / Cancel)

   Design decisions locked in the c4d2 design conversation:
   - Backdrop click dismisses (= cancel)
   - Escape dismisses (= cancel)
   - Cancel-focused on open (safer default for destructive ops)
   - One modal at a time (confirm() rejects if one is already open)
   - Destructive variant uses --supernova for the confirm button

   DOM is created lazily on first call and re-used across opens.
   ============================================================ */

let root = null;          // the overlay element, created once
let activeResolve = null; // non-null while a modal is open

/* Idempotent DOM construction. Builds the overlay + panel once
   and keeps them hidden between uses. Faster than tearing down
   and rebuilding, and it means event listeners stay bound. */
function ensureRoot() {
  if (root) return root;

  root = document.createElement('div');
  root.className = 'modal-overlay';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  root.innerHTML = `
    <div class="modal-panel" role="document">
      <div class="modal-title"></div>
      <div class="modal-message"></div>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-cancel">Cancel</button>
        <button type="button" class="modal-btn modal-btn-confirm"></button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  /* Backdrop click — only counts when the click landed on the
     overlay itself, not on the panel or its descendants. */
  root.addEventListener('click', (e) => {
    if (e.target === root) resolveAndClose(false);
  });

  root.querySelector('.modal-btn-cancel').addEventListener('click', () => {
    resolveAndClose(false);
  });

  root.querySelector('.modal-btn-confirm').addEventListener('click', () => {
    resolveAndClose(true);
  });

  return root;
}

/* Global Escape handler. Single listener, gated on whether a
   modal is currently open. Registered once at module load so
   we don't add/remove listeners on every open. */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeResolve) {
    e.preventDefault();
    resolveAndClose(false);
  }
});

function resolveAndClose(result) {
  if (!activeResolve) return;
  const r = activeResolve;
  activeResolve = null;
  root.hidden = true;
  r(result);
}

/* Public entry point. Returns Promise<boolean>. Rejects if a
   modal is already open — caller shouldn't attempt to stack,
   and hitting this rejection indicates a logic bug somewhere. */
export function confirm({
  title = 'Confirm',
  message = '',
  confirmLabel = 'Confirm',
  confirmVariant = 'default',
} = {}) {
  if (activeResolve) {
    return Promise.reject(new Error('modal: another modal is already open'));
  }

  const el = ensureRoot();

  el.querySelector('.modal-title').textContent = title;
  el.querySelector('.modal-message').textContent = message;

  const confirmBtn = el.querySelector('.modal-btn-confirm');
  confirmBtn.textContent = confirmLabel;
  confirmBtn.classList.toggle('destructive', confirmVariant === 'destructive');

  el.hidden = false;

  /* Focus the Cancel button so Enter cancels by default.
     Destructive actions should require a deliberate Tab →
     Enter, not a reflex Enter. */
  const cancelBtn = el.querySelector('.modal-btn-cancel');
  cancelBtn.focus();

  return new Promise((resolve) => {
    activeResolve = resolve;
  });
}
